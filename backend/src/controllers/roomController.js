const bcrypt = require("bcrypt");
const crypto = require("crypto");
const Room = require("../models/Room");

const DEFAULT_CODE = {
  javascript: '// Start coding together\nconsole.log("Hello from CodeRoom");\n',
  python: 'print("Hello from CodeRoom")\n',
  cpp:
    '#include <iostream>\nusing namespace std;\n\nint main() {\n  cout << "Hello from CodeRoom";\n  return 0;\n}\n',
  java:
    'class Main {\n  public static void main(String[] args) {\n    System.out.println("Hello from CodeRoom");\n  }\n}\n',
  html:
    '<main>\n  <h1>Hello from CodeRoom</h1>\n  <p>Edit HTML together and preview it here.</p>\n</main>\n',
  css:
    'body {\n  font-family: system-ui, sans-serif;\n  background: #101820;\n  color: #f7f7f7;\n}\n',
};

const WEB_STARTER_FILES = [
  {
    name: "index.html",
    language: "html",
    content:
      '<main class="app-shell">\n  <section>\n    <p class="eyebrow">CodeRoom Web App</p>\n    <h1 id="headline">Build in HTML, CSS, and JavaScript</h1>\n    <p id="status">Click the button to run JavaScript in this page.</p>\n    <button id="actionButton">Run interaction</button>\n  </section>\n</main>\n',
  },
  {
    name: "style.css",
    language: "css",
    content:
      ':root {\n  color-scheme: dark;\n  font-family: Inter, system-ui, sans-serif;\n}\n\nbody {\n  min-height: 100vh;\n  margin: 0;\n  display: grid;\n  place-items: center;\n  background: #0f172a;\n  color: #f8fafc;\n}\n\n.app-shell {\n  width: min(720px, calc(100vw - 40px));\n  border: 1px solid #334155;\n  border-radius: 16px;\n  background: #111827;\n  padding: 32px;\n}\n\n.eyebrow {\n  color: #2dd4bf;\n  font-size: 12px;\n  font-weight: 800;\n  text-transform: uppercase;\n}\n\nbutton {\n  border: 0;\n  border-radius: 10px;\n  background: #facc15;\n  color: #111827;\n  cursor: pointer;\n  font-weight: 900;\n  padding: 12px 16px;\n}\n',
  },
  {
    name: "script.js",
    language: "javascript",
    content:
      'const button = document.querySelector("#actionButton");\nconst status = document.querySelector("#status");\nlet clicks = 0;\n\nbutton.addEventListener("click", () => {\n  clicks += 1;\n  status.textContent = `JavaScript updated the page ${clicks} time${clicks === 1 ? "" : "s"}.`;\n  console.log("Button clicked", clicks);\n});\n\nconsole.log("HTML, CSS, and JavaScript are running together.");\n',
  },
];

const EXTENSIONS = {
  javascript: "js",
  python: "py",
  cpp: "cpp",
  java: "java",
  html: "html",
  css: "css",
};

const normalizeRoomId = (roomId) =>
  String(roomId || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");

const makeFileId = () =>
  crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");

const makeRoomId = () => {
  const raw = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
};

const generateUniqueRoomId = async () => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const roomId = makeRoomId();
    const existing = await Room.findOne({ roomId });

    if (!existing) {
      return roomId;
    }
  }

  return `${makeRoomId()}-${Date.now().toString(36).toUpperCase()}`;
};

const userIdOf = (user) => user._id.toString();

const isMember = (room, userId) =>
  room.members.some((member) => member.user.toString() === userId.toString());

const memberPayload = (user, role = "member") => ({
  user: user._id,
  name: user.name,
  email: user.email,
  role,
});

const serializeFile = (file) => ({
  fileId: file.fileId,
  name: file.name,
  language: file.language,
  content: file.content,
  createdAt: file.createdAt,
  updatedAt: file.updatedAt,
});

const serializeRoom = (room) => ({
  id: room._id.toString(),
  roomId: room.roomId,
  name: room.name,
  createdBy: room.createdBy.toString(),
  createdAt: room.createdAt,
  updatedAt: room.updatedAt,
  members: room.members.map((member) => ({
    id: member.user.toString(),
    name: member.name,
    email: member.email,
    role: member.role,
    joinedAt: member.joinedAt,
  })),
  files: room.files.map(serializeFile),
  shareUrl: `/editor/${room.roomId}`,
});

const roomSummary = (room) => ({
  roomId: room.roomId,
  name: room.name,
  createdBy: room.createdBy.toString(),
  createdAt: room.createdAt,
  updatedAt: room.updatedAt,
  membersCount: room.members.length,
  filesCount: room.files.length,
});

const defaultFileFor = (language, user) => ({
  fileId: makeFileId(),
  name: `main.${EXTENSIONS[language] || "txt"}`,
  language,
  content: DEFAULT_CODE[language] || "",
  createdBy: user._id,
  updatedBy: user._id,
});

const defaultFilesFor = (language, user) => {
  if (language === "web") {
    return WEB_STARTER_FILES.map((file) => ({
      ...file,
      fileId: makeFileId(),
      createdBy: user._id,
      updatedBy: user._id,
    }));
  }

  const safeLanguage = DEFAULT_CODE[language] ? language : "javascript";
  return [defaultFileFor(safeLanguage, user)];
};

exports.createRoom = async (req, res) => {
  try {
    const name = String(req.body.name || "Untitled room").trim();
    const password = String(req.body.password || "").trim();
    const language = String(req.body.language || "javascript").toLowerCase();
    const requestedRoomId = normalizeRoomId(req.body.roomId);

    if (!password || password.length < 4) {
      return res
        .status(400)
        .json({ msg: "Room password must be at least 4 characters" });
    }

    if (requestedRoomId) {
      const existing = await Room.findOne({ roomId: requestedRoomId });

      if (existing) {
        return res.status(409).json({ msg: "Room ID is already taken" });
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const roomId = requestedRoomId || (await generateUniqueRoomId());

    const room = await Room.create({
      roomId,
      name,
      passwordHash,
      createdBy: req.user._id,
      members: [memberPayload(req.user, "owner")],
      files: defaultFilesFor(language, req.user),
    });

    return res.status(201).json({ room: serializeRoom(room) });
  } catch (error) {
    return res.status(500).json({ msg: "Unable to create room" });
  }
};

exports.joinRoom = async (req, res) => {
  try {
    const roomId = normalizeRoomId(req.params.roomId);
    const password = String(req.body.password || "");
    const room = await Room.findOne({ roomId });

    if (!room) {
      return res.status(404).json({ msg: "Room not found" });
    }

    if (!isMember(room, userIdOf(req.user))) {
      const ok = await bcrypt.compare(password, room.passwordHash);

      if (!ok) {
        return res.status(401).json({ msg: "Incorrect room password" });
      }

      room.members.push(memberPayload(req.user));
      await room.save();
    }

    return res.json({ room: serializeRoom(room) });
  } catch (error) {
    return res.status(500).json({ msg: "Unable to join room" });
  }
};

exports.listRooms = async (req, res) => {
  try {
    const userId = userIdOf(req.user);
    const rooms = await Room.find({ "members.user": req.user._id }).sort({
      updatedAt: -1,
    });

    const createdRooms = rooms
      .filter((room) => room.createdBy.toString() === userId)
      .map(roomSummary);
    const joinedRooms = rooms
      .filter((room) => room.createdBy.toString() !== userId)
      .map(roomSummary);

    const savedFiles = rooms.flatMap((room) =>
      room.files.map((file) => ({
        roomId: room.roomId,
        roomName: room.name,
        fileId: file.fileId,
        name: file.name,
        language: file.language,
        updatedAt: file.updatedAt,
      }))
    );

    return res.json({ createdRooms, joinedRooms, savedFiles });
  } catch (error) {
    return res.status(500).json({ msg: "Unable to load rooms" });
  }
};

exports.getRoom = async (req, res) => {
  try {
    const roomId = normalizeRoomId(req.params.roomId);
    const room = await Room.findOne({ roomId });

    if (!room) {
      return res.status(404).json({ msg: "Room not found" });
    }

    if (!isMember(room, userIdOf(req.user))) {
      return res.status(403).json({
        msg: "Room password required",
        requiresPassword: true,
        room: {
          roomId: room.roomId,
          name: room.name,
        },
      });
    }

    return res.json({ room: serializeRoom(room) });
  } catch (error) {
    return res.status(500).json({ msg: "Unable to load room" });
  }
};

exports.deleteRoom = async (req, res) => {
  try {
    const roomId = normalizeRoomId(req.params.roomId);
    const room = await Room.findOne({ roomId });

    if (!room) {
      return res.status(404).json({ msg: "Room not found" });
    }

    if (room.createdBy.toString() !== userIdOf(req.user)) {
      return res.status(403).json({ msg: "Only the room owner can delete it" });
    }

    await Room.deleteOne({ _id: room._id });

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ msg: "Unable to delete room" });
  }
};

exports.createFile = async (req, res) => {
  try {
    const roomId = normalizeRoomId(req.params.roomId);
    const room = await Room.findOne({ roomId });

    if (!room) {
      return res.status(404).json({ msg: "Room not found" });
    }

    if (!isMember(room, userIdOf(req.user))) {
      return res.status(403).json({ msg: "Join the room before editing files" });
    }

    const language = String(req.body.language || "javascript").toLowerCase();
    const fallbackName = `untitled.${EXTENSIONS[language] || "txt"}`;
    const file = {
      fileId: makeFileId(),
      name: String(req.body.name || fallbackName).trim() || fallbackName,
      language,
      content:
        typeof req.body.content === "string"
          ? req.body.content
          : DEFAULT_CODE[language] || "",
      createdBy: req.user._id,
      updatedBy: req.user._id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    room.files.push(file);
    await room.save();

    return res.status(201).json({ file: serializeFile(file) });
  } catch (error) {
    return res.status(500).json({ msg: "Unable to create file" });
  }
};

exports.updateFile = async (req, res) => {
  try {
    const roomId = normalizeRoomId(req.params.roomId);
    const room = await Room.findOne({ roomId });

    if (!room) {
      return res.status(404).json({ msg: "Room not found" });
    }

    if (!isMember(room, userIdOf(req.user))) {
      return res.status(403).json({ msg: "Join the room before editing files" });
    }

    const file = room.files.find((item) => item.fileId === req.params.fileId);

    if (!file) {
      return res.status(404).json({ msg: "File not found" });
    }

    if (typeof req.body.name === "string") {
      file.name = req.body.name.trim() || file.name;
    }

    if (typeof req.body.language === "string") {
      file.language = req.body.language.toLowerCase();
    }

    if (typeof req.body.content === "string") {
      file.content = req.body.content;
    }

    file.updatedBy = req.user._id;
    file.updatedAt = new Date();
    await room.save();

    return res.json({ file: serializeFile(file) });
  } catch (error) {
    return res.status(500).json({ msg: "Unable to save file" });
  }
};

exports.deleteFile = async (req, res) => {
  try {
    const roomId = normalizeRoomId(req.params.roomId);
    const room = await Room.findOne({ roomId });

    if (!room) {
      return res.status(404).json({ msg: "Room not found" });
    }

    if (!isMember(room, userIdOf(req.user))) {
      return res.status(403).json({ msg: "Join the room before editing files" });
    }

    if (room.files.length <= 1) {
      return res.status(400).json({ msg: "A room needs at least one file" });
    }

    room.files = room.files.filter((file) => file.fileId !== req.params.fileId);
    await room.save();

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ msg: "Unable to delete file" });
  }
};
