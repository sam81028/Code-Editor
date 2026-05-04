const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const Room = require("../models/Room");
const User = require("../models/User");

const serializeFile = (file) => ({
  fileId: file.fileId,
  name: file.name,
  language: file.language,
  content: file.content,
  createdAt: file.createdAt,
  updatedAt: file.updatedAt,
});

const serializeRoom = (room) => ({
  roomId: room.roomId,
  name: room.name,
  members: room.members.map((member) => ({
    id: member.user.toString(),
    name: member.name,
    email: member.email,
    role: member.role,
  })),
  files: room.files.map(serializeFile),
});

const normalizeRoomId = (roomId) =>
  String(roomId || "")
    .trim()
    .toUpperCase();

const isRoomMember = (room, userId) =>
  room.members.some((member) => member.user.toString() === userId);

const getSocketUser = async (token) => {
  if (!token) {
    return null;
  }

  const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev-secret");
  const user = await User.findById(decoded.id).select("name email");

  if (!user) {
    return null;
  }

  return {
    id: user._id.toString(),
    name: user.name || user.email,
    email: user.email,
  };
};

const socketHandler = (server) => {
  const io = new Server(server, {
    cors: { origin: process.env.CLIENT_ORIGIN || "*" },
  });

  const onlineUsers = new Map();
  const pendingSaves = new Map();

  const emitUserList = (roomId) => {
    const users = Array.from(onlineUsers.get(roomId)?.values() || []);
    io.to(roomId).emit("user-list", users);
  };

  const scheduleFileSave = ({ roomId, fileId, code, language, userId }) => {
    const key = `${roomId}:${fileId}`;

    if (pendingSaves.has(key)) {
      clearTimeout(pendingSaves.get(key));
    }

    const timer = setTimeout(async () => {
      try {
        await Room.updateOne(
          {
            roomId,
            "members.user": userId,
          },
          {
            $set: {
              "files.$[file].content": code,
              "files.$[file].language": language,
              "files.$[file].updatedAt": new Date(),
              "files.$[file].updatedBy": userId,
            },
          },
          {
            arrayFilters: [{ "file.fileId": fileId }],
          }
        );
      } catch (error) {
        console.error("Socket file save failed:", error.message);
      } finally {
        pendingSaves.delete(key);
      }
    }, 600);

    pendingSaves.set(key, timer);
  };

  io.use(async (socket, next) => {
    try {
      const user = await getSocketUser(socket.handshake.auth?.token);

      if (!user) {
        return next(new Error("Unauthorized"));
      }

      socket.data.user = user;
      socket.data.rooms = new Set();
      return next();
    } catch (error) {
      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    socket.on("join-room", async ({ roomId }, ack) => {
      try {
        const normalizedRoomId = normalizeRoomId(roomId);
        const room = await Room.findOne({ roomId: normalizedRoomId });

        if (!room || !isRoomMember(room, socket.data.user.id)) {
          if (typeof ack === "function") {
            ack({ ok: false, msg: "Join the room before opening sockets" });
          }
          return;
        }

        socket.join(normalizedRoomId);
        socket.data.rooms.add(normalizedRoomId);

        if (!onlineUsers.has(normalizedRoomId)) {
          onlineUsers.set(normalizedRoomId, new Map());
        }

        onlineUsers.get(normalizedRoomId).set(socket.id, {
          socketId: socket.id,
          id: socket.data.user.id,
          name: socket.data.user.name,
          email: socket.data.user.email,
        });

        socket.emit("room-state", { room: serializeRoom(room) });
        emitUserList(normalizedRoomId);

        if (typeof ack === "function") {
          ack({ ok: true });
        }
      } catch (error) {
        if (typeof ack === "function") {
          ack({ ok: false, msg: "Unable to join room" });
        }
      }
    });

    socket.on("code-change", ({ roomId, fileId, code, language }) => {
      const normalizedRoomId = normalizeRoomId(roomId);

      if (!socket.data.rooms.has(normalizedRoomId) || !fileId) {
        return;
      }

      const payload = {
        fileId,
        code: typeof code === "string" ? code : "",
        language: language || "javascript",
        updatedBy: socket.data.user.email,
        updatedAt: new Date().toISOString(),
      };

      socket.to(normalizedRoomId).emit("code-update", payload);
      scheduleFileSave({
        roomId: normalizedRoomId,
        fileId,
        code: payload.code,
        language: payload.language,
        userId: socket.data.user.id,
      });
    });

    socket.on("file-created", ({ roomId, file }) => {
      const normalizedRoomId = normalizeRoomId(roomId);

      if (socket.data.rooms.has(normalizedRoomId) && file) {
        socket.to(normalizedRoomId).emit("file-created", file);
      }
    });

    socket.on("file-deleted", ({ roomId, fileId }) => {
      const normalizedRoomId = normalizeRoomId(roomId);

      if (socket.data.rooms.has(normalizedRoomId) && fileId) {
        socket.to(normalizedRoomId).emit("file-deleted", { fileId });
      }
    });

    socket.on("send-message", ({ roomId, message }) => {
      const normalizedRoomId = normalizeRoomId(roomId);
      const cleanMessage = String(message || "").trim();

      if (!socket.data.rooms.has(normalizedRoomId) || !cleanMessage) {
        return;
      }

      io.to(normalizedRoomId).emit("receive-message", {
        message: cleanMessage,
        user: socket.data.user,
        createdAt: new Date().toISOString(),
      });
    });

    socket.on("disconnect", () => {
      for (const roomId of socket.data.rooms || []) {
        const roomUsers = onlineUsers.get(roomId);

        if (roomUsers) {
          roomUsers.delete(socket.id);

          if (roomUsers.size === 0) {
            onlineUsers.delete(roomId);
          }
        }

        emitUserList(roomId);
      }
    });
  });
};

module.exports = socketHandler;
