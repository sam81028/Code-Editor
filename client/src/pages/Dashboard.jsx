import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  apiFetch,
  clearSession,
  getShareUrl,
  getUser,
} from "../lib/api";

const LANGUAGES = [
  { label: "Web App (HTML/CSS/JS)", value: "web" },
  { label: "JavaScript", value: "javascript" },
  { label: "Python", value: "python" },
  { label: "C++", value: "cpp" },
  { label: "Java", value: "java" },
  { label: "HTML", value: "html" },
  { label: "CSS", value: "css" },
];

const fileKey = (file) => `${file.roomId}-${file.fileId}`;

function RoomTile({ canDelete, deleting, label, onDelete, room }) {
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(getShareUrl(room.roomId));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch (error) {
      setCopied(false);
    }
  };

  return (
    <article className="room-tile">
      <div>
        <p className="eyebrow">{label}</p>
        <h3>{room.name}</h3>
        <p className="room-id">{room.roomId}</p>
      </div>
      <div className="room-meta">
        <span>{room.membersCount} members</span>
        <span>{room.filesCount} files</span>
      </div>
      <div className="tile-actions">
        <Link className="secondary-action" to={`/editor/${room.roomId}`}>
          Open
        </Link>
        <button className="ghost-action" onClick={copyLink} type="button">
          {copied ? "Copied" : "Copy link"}
        </button>
        <button
          aria-label={`Delete room ${room.name}`}
          className="icon-action danger-icon"
          disabled={!canDelete || deleting}
          onClick={() => onDelete(room)}
          title={canDelete ? "Delete room" : "Only owners can delete rooms"}
          type="button"
        >
          {deleting ? "..." : "\u{1F5D1}"}
        </button>
      </div>
    </article>
  );
}

function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(getUser());
  const [createdRooms, setCreatedRooms] = useState([]);
  const [joinedRooms, setJoinedRooms] = useState([]);
  const [savedFiles, setSavedFiles] = useState([]);
  const [createForm, setCreateForm] = useState({
    name: "New project room",
    password: "",
    language: "web",
  });
  const [joinForm, setJoinForm] = useState({ roomId: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [deletingRoomId, setDeletingRoomId] = useState("");
  const [deletingFileId, setDeletingFileId] = useState("");

  const allRoomsCount = useMemo(
    () => createdRooms.length + joinedRooms.length,
    [createdRooms.length, joinedRooms.length]
  );

  const loadDashboard = async () => {
    setLoading(true);
    setError("");

    try {
      const [meData, roomsData] = await Promise.all([
        apiFetch("/api/auth/me"),
        apiFetch("/api/rooms"),
      ]);
      setUser(meData.user);
      localStorage.setItem("user", JSON.stringify(meData.user));
      setCreatedRooms(roomsData.createdRooms || []);
      setJoinedRooms(roomsData.joinedRooms || []);
      setSavedFiles(roomsData.savedFiles || []);
    } catch (err) {
      if (err.status === 401) {
        clearSession();
        navigate("/login", { replace: true });
        return;
      }

      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const handleLogout = () => {
    clearSession();
    navigate("/login", { replace: true });
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    setError("");
    setBusy("create");

    try {
      const data = await apiFetch("/api/rooms", {
        method: "POST",
        body: createForm,
      });
      navigate(`/editor/${data.room.roomId}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  const handleJoin = async (event) => {
    event.preventDefault();
    setError("");
    setBusy("join");

    try {
      const roomId = joinForm.roomId.trim().toUpperCase();
      const data = await apiFetch(`/api/rooms/${roomId}/join`, {
        method: "POST",
        body: { password: joinForm.password },
      });
      navigate(`/editor/${data.room.roomId}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  const handleDeleteRoom = async (room) => {
    if (!window.confirm("Are you sure you want to delete this room?")) {
      return;
    }

    setError("");
    setDeletingRoomId(room.roomId);
    const previousCreatedRooms = createdRooms;
    const previousJoinedRooms = joinedRooms;
    const previousSavedFiles = savedFiles;

    setCreatedRooms((current) =>
      current.filter((item) => item.roomId !== room.roomId)
    );
    setJoinedRooms((current) =>
      current.filter((item) => item.roomId !== room.roomId)
    );
    setSavedFiles((current) =>
      current.filter((file) => file.roomId !== room.roomId)
    );

    try {
      await apiFetch(`/api/rooms/${room.roomId}`, { method: "DELETE" });
    } catch (err) {
      setCreatedRooms(previousCreatedRooms);
      setJoinedRooms(previousJoinedRooms);
      setSavedFiles(previousSavedFiles);
      setError(err.message);
    } finally {
      setDeletingRoomId("");
    }
  };

  const handleDeleteSavedFile = async (file) => {
    if (!window.confirm("Delete this saved file?")) {
      return;
    }

    const key = fileKey(file);
    setError("");
    setDeletingFileId(key);
    const previousSavedFiles = savedFiles;

    setSavedFiles((current) => current.filter((item) => fileKey(item) !== key));

    try {
      await apiFetch(`/api/rooms/${file.roomId}/files/${file.fileId}`, {
        method: "DELETE",
      });
      setCreatedRooms((current) =>
        current.map((room) =>
          room.roomId === file.roomId
            ? { ...room, filesCount: Math.max(0, room.filesCount - 1) }
            : room
        )
      );
      setJoinedRooms((current) =>
        current.map((room) =>
          room.roomId === file.roomId
            ? { ...room, filesCount: Math.max(0, room.filesCount - 1) }
            : room
        )
      );
    } catch (err) {
      setSavedFiles(previousSavedFiles);
      setError(err.message);
    } finally {
      setDeletingFileId("");
    }
  };

  return (
    <main className="dashboard-page">
      <header className="top-nav">
        <div>
          <p className="eyebrow">Collaborative code editor</p>
          <h1>Dashboard</h1>
        </div>
        <div className="nav-actions">
          <span>{user?.email}</span>
          <button className="ghost-action" onClick={handleLogout} type="button">
            Log out
          </button>
        </div>
      </header>

      <section className="metrics-row">
        <div className="metric">
          <span>{createdRooms.length}</span>
          Created rooms
        </div>
        <div className="metric">
          <span>{joinedRooms.length}</span>
          Joined rooms
        </div>
        <div className="metric">
          <span>{savedFiles.length}</span>
          Saved files
        </div>
        <div className="metric">
          <span>{allRoomsCount}</span>
          Active workspaces
        </div>
      </section>

      {error && <p className="page-error">{error}</p>}

      <section className="dashboard-grid">
        <form className="workspace-panel" onSubmit={handleCreate}>
          <div>
            <p className="eyebrow">New room</p>
            <h2>Create project room</h2>
          </div>
          <label>
            Room name
            <input
              onChange={(event) =>
                setCreateForm((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              value={createForm.name}
            />
          </label>
          <label>
            Room password
            <input
              minLength={4}
              onChange={(event) =>
                setCreateForm((current) => ({
                  ...current,
                  password: event.target.value,
                }))
              }
              placeholder="Required for link access"
              type="password"
              value={createForm.password}
            />
          </label>
          <label>
            Starter language
            <select
              onChange={(event) =>
                setCreateForm((current) => ({
                  ...current,
                  language: event.target.value,
                }))
              }
              value={createForm.language}
            >
              {LANGUAGES.map((language) => (
                <option key={language.value} value={language.value}>
                  {language.label}
                </option>
              ))}
            </select>
          </label>
          <button className="primary-action" disabled={busy === "create"}>
            {busy === "create" ? "Creating..." : "Create room"}
          </button>
        </form>

        <form className="workspace-panel" onSubmit={handleJoin}>
          <div>
            <p className="eyebrow">Existing room</p>
            <h2>Join by Room ID</h2>
          </div>
          <label>
            Room ID
            <input
              onChange={(event) =>
                setJoinForm((current) => ({
                  ...current,
                  roomId: event.target.value.toUpperCase(),
                }))
              }
              placeholder="ABCD-1234"
              value={joinForm.roomId}
            />
          </label>
          <label>
            Password
            <input
              onChange={(event) =>
                setJoinForm((current) => ({
                  ...current,
                  password: event.target.value,
                }))
              }
              type="password"
              value={joinForm.password}
            />
          </label>
          <button className="primary-action" disabled={busy === "join"}>
            {busy === "join" ? "Joining..." : "Join room"}
          </button>
        </form>
      </section>

      <section className="room-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Your rooms</p>
            <h2>Created rooms</h2>
          </div>
        </div>
        <div className="room-list">
          {loading && <p className="muted-line">Loading rooms...</p>}
          {!loading && createdRooms.length === 0 && (
            <p className="muted-line">No created rooms yet.</p>
          )}
          {createdRooms.map((room) => (
            <RoomTile
              canDelete
              deleting={deletingRoomId === room.roomId}
              key={room.roomId}
              label="Owner"
              onDelete={handleDeleteRoom}
              room={room}
            />
          ))}
        </div>
      </section>

      <section className="room-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Shared with you</p>
            <h2>Joined rooms</h2>
          </div>
        </div>
        <div className="room-list">
          {!loading && joinedRooms.length === 0 && (
            <p className="muted-line">No joined rooms yet.</p>
          )}
          {joinedRooms.map((room) => (
            <RoomTile
              canDelete={false}
              deleting={false}
              key={room.roomId}
              label="Member"
              onDelete={handleDeleteRoom}
              room={room}
            />
          ))}
        </div>
      </section>

      <section className="files-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Reopen work</p>
            <h2>Saved files</h2>
          </div>
        </div>
        <div className="saved-files">
          {!loading && savedFiles.length === 0 && (
            <p className="muted-line">Files saved in rooms will appear here.</p>
          )}
          {savedFiles.map((file) => (
            <article className="saved-file-card" key={fileKey(file)}>
              <Link
                className="saved-file-link"
                to={`/editor/${file.roomId}?file=${file.fileId}`}
              >
                <span>{file.name}</span>
                <small>
                  {file.roomName} - {file.language}
                </small>
              </Link>
              <button
                aria-label={`Delete file ${file.name}`}
                className="icon-action danger-icon"
                disabled={deletingFileId === fileKey(file)}
                onClick={() => handleDeleteSavedFile(file)}
                title="Delete file"
                type="button"
              >
                {deletingFileId === fileKey(file) ? "..." : "\u{1F5D1}"}
              </button>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

export default Dashboard;
