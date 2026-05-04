const express = require("express");
const auth = require("../middleware/auth");
const {
  createFile,
  createRoom,
  deleteFile,
  deleteRoom,
  getRoom,
  joinRoom,
  listRooms,
  updateFile,
} = require("../controllers/roomController");

const router = express.Router();

router.use(auth);

router.get("/", listRooms);
router.post("/", createRoom);
router.get("/:roomId", getRoom);
router.delete("/:roomId", deleteRoom);
router.post("/:roomId/join", joinRoom);
router.post("/:roomId/files", createFile);
router.patch("/:roomId/files/:fileId", updateFile);
router.delete("/:roomId/files/:fileId", deleteFile);

module.exports = router;
