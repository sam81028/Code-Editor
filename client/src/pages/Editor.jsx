import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MonacoEditor from "@monaco-editor/react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { io } from "socket.io-client";
import {
  API_BASE_URL,
  apiFetch,
  clearSession,
  getShareUrl,
  getToken,
} from "../lib/api";

const LANGUAGES = [
  { label: "JavaScript", value: "javascript" },
  { label: "Python", value: "python" },
  { label: "C++", value: "cpp" },
  { label: "Java", value: "java" },
  { label: "HTML", value: "html" },
  { label: "CSS", value: "css" },
];

const WEB_LANGUAGES = new Set(["html", "css", "javascript"]);

const EXTENSIONS = {
  javascript: "js",
  python: "py",
  cpp: "cpp",
  java: "java",
  html: "html",
  css: "css",
};

const DEFAULT_CODE = {
  javascript: '// Start coding together\nconsole.log("Hello from CodeRoom");\n',
  python: 'print("Hello from CodeRoom")\n',
  cpp:
    '#include <iostream>\nusing namespace std;\n\nint main() {\n  cout << "Hello from CodeRoom";\n  return 0;\n}\n',
  java:
    'class Main {\n  public static void main(String[] args) {\n    System.out.println("Hello from CodeRoom");\n  }\n}\n',
  html:
    '<main>\n  <h1>Hello from CodeRoom</h1>\n  <p>Live HTML preview is on the right.</p>\n</main>\n',
  css:
    'body {\n  font-family: system-ui, sans-serif;\n  background: #101820;\n  color: white;\n}\n',
};

const escapeClosingTags = (content, tagName) =>
  String(content || "").replace(
    new RegExp(`</${tagName}`, "gi"),
    `<\\/${tagName}`
  );

const getCurrentFileContent = (file, activeFileId, activeCode) =>
  file.fileId === activeFileId ? activeCode : file.content || "";

const getCombinedWebAssets = (files = [], activeFileId, activeCode) => {
  const webFiles = files.filter((file) => WEB_LANGUAGES.has(file.language));
  const byLanguage = (language) =>
    webFiles
      .filter((file) => file.language === language)
      .map((file) => ({
        name: file.name,
        content: getCurrentFileContent(file, activeFileId, activeCode),
      }));

  return {
    htmlFiles: byLanguage("html"),
    cssFiles: byLanguage("css"),
    jsFiles: byLanguage("javascript"),
  };
};

const buildConsoleBridge = (runId) => `
<script>
(() => {
  const send = (type, args) => {
    window.parent.postMessage({
      source: "coderoom-preview",
      runId: ${JSON.stringify(runId)},
      type,
      message: Array.from(args).map((item) => {
        if (typeof item === "string") return item;
        try {
          return JSON.stringify(item);
        } catch (error) {
          return String(item);
        }
      }).join(" ")
    }, "*");
  };

  ["log", "info", "warn", "error"].forEach((method) => {
    const original = console[method];
    console[method] = (...args) => {
      send(method, args);
      original.apply(console, args);
    };
  });

  window.addEventListener("error", (event) => {
    send("error", [event.message]);
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    send("error", [reason && reason.message ? reason.message : reason]);
  });
})();
</script>`;

const injectWebAssets = ({ html, css, js, runId }) => {
  const styleTag = css.trim()
    ? `<style>\n${escapeClosingTags(css, "style")}\n</style>`
    : "";
  const scriptTag = js.trim()
    ? `${buildConsoleBridge(runId)}\n<script>\n${escapeClosingTags(
        js,
        "script"
      )}\n</script>`
    : buildConsoleBridge(runId);

  if (/<html[\s>]/i.test(html)) {
    const withStyles = /<\/head>/i.test(html)
      ? html.replace(/<\/head>/i, `${styleTag}\n</head>`)
      : html.replace(/<html[^>]*>/i, (match) => `${match}<head>${styleTag}</head>`);

    return /<\/body>/i.test(withStyles)
      ? withStyles.replace(/<\/body>/i, `${scriptTag}\n</body>`)
      : `${withStyles}\n${scriptTag}`;
  }

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${styleTag}
  </head>
  <body>
    ${html || '<main id="app"></main>'}
    ${scriptTag}
  </body>
</html>`;
};

const monacoLanguage = (language) => {
  if (language === "cpp") {
    return "cpp";
  }

  return language || "javascript";
};

function Editor() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [room, setRoom] = useState(null);
  const [activeFileId, setActiveFileId] = useState("");
  const [joinRequired, setJoinRequired] = useState(false);
  const [joinPassword, setJoinPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("javascript");
  const [output, setOutput] = useState("Console output will appear here.");
  const [running, setRunning] = useState(false);
  const [saveState, setSaveState] = useState("Saved");
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [split, setSplit] = useState(50);
  const [webRunId, setWebRunId] = useState(0);
  const [previewLogs, setPreviewLogs] = useState([]);
  const [fileForm, setFileForm] = useState({
    name: "untitled.js",
    language: "javascript",
  });
  const socketRef = useRef(null);
  const activeFileIdRef = useRef("");
  const remoteUpdateRef = useRef(false);
  const splitRef = useRef(null);

  const activeFile = useMemo(
    () => room?.files.find((file) => file.fileId === activeFileId),
    [activeFileId, room?.files]
  );

  const webAssets = useMemo(
    () => getCombinedWebAssets(room?.files || [], activeFileId, code),
    [activeFileId, code, room?.files]
  );

  const isWebProgram = useMemo(
    () =>
      WEB_LANGUAGES.has(language) &&
      (webAssets.htmlFiles.length > 0 ||
        webAssets.cssFiles.length > 0 ||
        language === "html" ||
        language === "css"),
    [language, webAssets.cssFiles.length, webAssets.htmlFiles.length]
  );

  const webPreviewDoc = useMemo(() => {
    const html = webAssets.htmlFiles
      .map((file) => `<!-- ${file.name} -->\n${file.content}`)
      .join("\n\n");
    const css = webAssets.cssFiles
      .map((file) => `/* ${file.name} */\n${file.content}`)
      .join("\n\n");
    const js = webAssets.jsFiles
      .map((file) => `// ${file.name}\n${file.content}`)
      .join("\n\n");

    return injectWebAssets({
      html,
      css,
      js,
      runId: webRunId,
    });
  }, [webAssets.cssFiles, webAssets.htmlFiles, webAssets.jsFiles, webRunId]);

  const visibleOutput = useMemo(() => {
    if (!previewLogs.length) {
      return output;
    }

    return `${output}\n\nBrowser console:\n${previewLogs.join("\n")}`;
  }, [output, previewLogs]);

  const applyRoom = useCallback((nextRoom) => {
    setRoom(nextRoom);
    const requestedFile = new URLSearchParams(window.location.search).get(
      "file"
    );
    const nextFile =
      nextRoom.files.find((file) => file.fileId === requestedFile) ||
      nextRoom.files[0];

    if (nextFile) {
      setActiveFileId((current) =>
        nextRoom.files.some((file) => file.fileId === current)
          ? current
          : nextFile.fileId
      );
    }
  }, []);

  const loadRoom = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const data = await apiFetch(`/api/rooms/${roomId}`);
      setJoinRequired(false);
      applyRoom(data.room);
    } catch (err) {
      if (err.status === 401) {
        clearSession();
        navigate("/login", {
          replace: true,
          state: { from: `/editor/${roomId}` },
        });
        return;
      }

      if (err.status === 403 && err.data?.requiresPassword) {
        setRoom(err.data.room);
        setJoinRequired(true);
        return;
      }

      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [applyRoom, navigate, roomId]);

  useEffect(() => {
    loadRoom();
  }, [loadRoom]);

  useEffect(() => {
    const handlePreviewMessage = (event) => {
      if (event.data?.source !== "coderoom-preview") {
        return;
      }

      const level = String(event.data.type || "log").toUpperCase();
      const messageText = String(event.data.message || "");
      setPreviewLogs((current) => [
        ...current.slice(-49),
        `[${level}] ${messageText}`,
      ]);
    };

    window.addEventListener("message", handlePreviewMessage);

    return () => {
      window.removeEventListener("message", handlePreviewMessage);
    };
  }, []);

  useEffect(() => {
    activeFileIdRef.current = activeFileId;

    if (activeFileId && searchParams.get("file") !== activeFileId) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("file", activeFileId);
      setSearchParams(nextParams, { replace: true });
    }
  }, [activeFileId, searchParams, setSearchParams]);

  useEffect(() => {
    if (!activeFile) {
      return;
    }

    setCode(activeFile.content || "");
    setLanguage(activeFile.language || "javascript");
    setSaveState("Saved");
  }, [activeFile?.fileId]);

  useEffect(() => {
    if (!room?.roomId || joinRequired) {
      return undefined;
    }

    const socket = io(API_BASE_URL, {
      auth: { token: getToken() },
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("join-room", { roomId: room.roomId }, (ack) => {
        if (ack && !ack.ok) {
          setError(ack.msg || "Socket room join failed");
        }
      });
    });

    socket.on("connect_error", () => {
      setError("Realtime connection failed. Check the backend server.");
    });

    socket.on("room-state", ({ room: socketRoom }) => {
      setRoom((current) => ({
        ...(current || {}),
        members: socketRoom.members || current?.members || [],
        files: socketRoom.files || current?.files || [],
      }));
    });

    socket.on("user-list", (users) => {
      setOnlineUsers(users || []);
    });

    socket.on("code-update", (payload) => {
      setRoom((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          files: current.files.map((file) =>
            file.fileId === payload.fileId
              ? {
                  ...file,
                  content: payload.code,
                  language: payload.language,
                  updatedAt: payload.updatedAt,
                }
              : file
          ),
        };
      });

      if (payload.fileId === activeFileIdRef.current) {
        remoteUpdateRef.current = true;
        setCode(payload.code);
        setLanguage(payload.language);
        setSaveState(`Synced from ${payload.updatedBy}`);
        window.setTimeout(() => {
          remoteUpdateRef.current = false;
        }, 0);
      }
    });

    socket.on("file-created", (file) => {
      setRoom((current) => {
        if (!current || current.files.some((item) => item.fileId === file.fileId)) {
          return current;
        }

        return {
          ...current,
          files: [...current.files, file],
        };
      });
    });

    socket.on("file-deleted", ({ fileId }) => {
      setRoom((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          files: current.files.filter((file) => file.fileId !== fileId),
        };
      });
    });

    socket.on("receive-message", (payload) => {
      setMessages((current) => [...current.slice(-49), payload]);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [joinRequired, room?.roomId]);

  const updateActiveFile = (updates) => {
    setRoom((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        files: current.files.map((file) =>
          file.fileId === activeFileId ? { ...file, ...updates } : file
        ),
      };
    });
  };

  const handleJoinRoom = async (event) => {
    event.preventDefault();
    setError("");

    try {
      const data = await apiFetch(`/api/rooms/${roomId}/join`, {
        method: "POST",
        body: { password: joinPassword },
      });
      setJoinPassword("");
      setJoinRequired(false);
      applyRoom(data.room);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCodeChange = (value) => {
    if (remoteUpdateRef.current) {
      return;
    }

    const nextCode = value || "";
    setCode(nextCode);
    setSaveState("Unsaved");
    updateActiveFile({ content: nextCode, language });

    socketRef.current?.emit("code-change", {
      roomId: room.roomId,
      fileId: activeFileId,
      code: nextCode,
      language,
    });
  };

  const handleLanguageChange = (event) => {
    const nextLanguage = event.target.value;
    setLanguage(nextLanguage);
    setSaveState("Unsaved");
    updateActiveFile({ language: nextLanguage });

    socketRef.current?.emit("code-change", {
      roomId: room.roomId,
      fileId: activeFileId,
      code,
      language: nextLanguage,
    });
  };

  const saveFile = async () => {
    if (!activeFile) {
      return;
    }

    setSaveState("Saving...");

    try {
      const data = await apiFetch(
        `/api/rooms/${room.roomId}/files/${activeFile.fileId}`,
        {
          method: "PATCH",
          body: {
            name: activeFile.name,
            language,
            content: code,
          },
        }
      );
      updateActiveFile(data.file);
      setSaveState("Saved");
    } catch (err) {
      setSaveState("Save failed");
      setError(err.message);
    }
  };

  const runCode = async () => {
    setRunning(true);
    setOutput("Running...");

    try {
      if (isWebProgram) {
        setPreviewLogs([]);
        setWebRunId((current) => current + 1);
        setOutput(
          "Web app preview refreshed. HTML, CSS, and JavaScript files are running together."
        );
        return;
      }

      const data = await apiFetch("/api/run", {
        method: "POST",
        body: { language, code },
      });
      setOutput(data.output || "No output");
    } catch (err) {
      setOutput(err.message);
    } finally {
      setRunning(false);
    }
  };

  const createFile = async (event) => {
    event.preventDefault();
    setError("");

    try {
      const fileName =
        fileForm.name.trim() ||
        `untitled.${EXTENSIONS[fileForm.language] || "txt"}`;
      const data = await apiFetch(`/api/rooms/${room.roomId}/files`, {
        method: "POST",
        body: {
          name: fileName,
          language: fileForm.language,
          content: DEFAULT_CODE[fileForm.language] || "",
        },
      });

      setRoom((current) => ({
        ...current,
        files: [...current.files, data.file],
      }));
      setActiveFileId(data.file.fileId);
      socketRef.current?.emit("file-created", {
        roomId: room.roomId,
        file: data.file,
      });
      setFileForm({
        name: `untitled.${EXTENSIONS[fileForm.language] || "txt"}`,
        language: fileForm.language,
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const deleteFile = async () => {
    if (!activeFile || room.files.length <= 1) {
      return;
    }

    if (!window.confirm("Delete active file?")) {
      return;
    }

    try {
      await apiFetch(`/api/rooms/${room.roomId}/files/${activeFile.fileId}`, {
        method: "DELETE",
      });
      const nextFiles = room.files.filter(
        (file) => file.fileId !== activeFile.fileId
      );
      setRoom((current) => ({ ...current, files: nextFiles }));
      setActiveFileId(nextFiles[0]?.fileId || "");
      socketRef.current?.emit("file-deleted", {
        roomId: room.roomId,
        fileId: activeFile.fileId,
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const closeRoom = () => {
    if (window.confirm("Leave this room?")) {
      navigate("/dashboard");
    }
  };

  const downloadFile = () => {
    if (!activeFile) {
      return;
    }

    const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = activeFile.name;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(getShareUrl(room.roomId));
      setSaveState("Link copied");
    } catch (error) {
      setSaveState("Copy failed");
    }
  };

  const sendMessage = () => {
    if (!message.trim()) {
      return;
    }

    socketRef.current?.emit("send-message", {
      roomId: room.roomId,
      message,
    });
    setMessage("");
  };

  const startResize = (event) => {
    event.preventDefault();
    const container = splitRef.current;

    if (!container) {
      return;
    }

    const handleMove = (moveEvent) => {
      const bounds = container.getBoundingClientRect();
      const nextSplit = ((moveEvent.clientX - bounds.left) / bounds.width) * 100;
      setSplit(Math.min(70, Math.max(35, nextSplit)));
    };

    const stopResize = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stopResize);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", stopResize);
  };

  const previewDoc = useMemo(() => {
    if (language === "html") {
      return code;
    }

    if (language === "css") {
      return `<style>${code}</style><main><h1>CSS preview</h1><p>Your stylesheet is applied to this preview document.</p><button>Button</button></main>`;
    }

    return "";
  }, [code, language]);

  if (loading) {
    return (
      <main className="loading-page">
        <p className="eyebrow">Opening room</p>
        <h1>Loading workspace...</h1>
      </main>
    );
  }

  if (joinRequired) {
    return (
      <main className="join-page">
        <form className="auth-panel" onSubmit={handleJoinRoom}>
          <p className="eyebrow">Protected room</p>
          <h1>{room?.name || roomId}</h1>
          <p className="muted-line">
            Enter the room password to join this shared workspace.
          </p>
          <label>
            Room password
            <input
              autoFocus
              onChange={(event) => setJoinPassword(event.target.value)}
              type="password"
              value={joinPassword}
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-action" type="submit">
            Join room
          </button>
          <Link className="secondary-action" to="/dashboard">
            Back to dashboard
          </Link>
        </form>
      </main>
    );
  }

  if (error && !room) {
    return (
      <main className="join-page">
        <section className="auth-panel">
          <p className="eyebrow">Room unavailable</p>
          <h1>{error}</h1>
          <Link className="primary-action" to="/dashboard">
            Back to dashboard
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="editor-page">
      <header className="editor-header">
        <div className="room-heading">
          <Link className="back-link" to="/dashboard">
            Dashboard
          </Link>
          <div>
            <p className="eyebrow">{room.roomId}</p>
            <h1>{room.name}</h1>
          </div>
        </div>
        <div className="editor-actions">
          <span className="save-state">{saveState}</span>
          <select onChange={handleLanguageChange} value={language}>
            {LANGUAGES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <button
            className="secondary-action"
            onClick={copyShareLink}
            title="Copy room link"
          >
            Copy link
          </button>
          <button
            className="secondary-action"
            onClick={downloadFile}
            title="Download active file"
          >
            Download
          </button>
          <button
            className="secondary-action"
            onClick={saveFile}
            title="Save active file"
          >
            Save
          </button>
          <button
            className="primary-action"
            disabled={running}
            onClick={runCode}
            title="Run code"
          >
            {running ? "Running..." : "Run"}
          </button>
          <button
            aria-label="Close room"
            className="close-room-button"
            onClick={closeRoom}
            title="Close room"
            type="button"
          >
            X
          </button>
        </div>
      </header>

      {error && <p className="page-error editor-error">{error}</p>}

      <section className="editor-workspace" ref={splitRef}>
        <section className="code-pane" style={{ flexBasis: `${split}%` }}>
          <aside className="file-rail">
            <div className="rail-section">
              <p className="eyebrow">Files</p>
              <div className="file-list">
                {room.files.map((file) => (
                  <button
                    className={
                      file.fileId === activeFileId ? "file-tab active" : "file-tab"
                    }
                    key={file.fileId}
                    onClick={() => setActiveFileId(file.fileId)}
                    title={`${file.name} (${file.language})`}
                    type="button"
                  >
                    <span>{file.name}</span>
                    <small>{file.language}</small>
                  </button>
                ))}
              </div>
            </div>

            <form className="new-file-form" onSubmit={createFile}>
              <p className="eyebrow">New file</p>
              <input
                onChange={(event) =>
                  setFileForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                value={fileForm.name}
              />
              <select
                onChange={(event) =>
                  setFileForm((current) => ({
                    ...current,
                    language: event.target.value,
                    name: `untitled.${
                      EXTENSIONS[event.target.value] || "txt"
                    }`,
                  }))
                }
                value={fileForm.language}
              >
                {LANGUAGES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <button className="secondary-action" type="submit">
                Add file
              </button>
            </form>

            <button
              className="danger-action"
              disabled={room.files.length <= 1}
              onClick={deleteFile}
              title="Delete active file"
              type="button"
            >
              Delete active file
            </button>
          </aside>

          <section className="monaco-shell">
            <MonacoEditor
              height="100%"
              language={monacoLanguage(language)}
              onChange={handleCodeChange}
              options={{
                automaticLayout: true,
                fontFamily:
                  "JetBrains Mono, Consolas, Monaco, 'Courier New', monospace",
                fontSize: 14,
                minimap: { enabled: false },
                padding: { top: 16, bottom: 16 },
                scrollBeyondLastLine: false,
                wordWrap: "on",
              }}
              theme="vs-dark"
              value={code}
            />
          </section>
        </section>

        <button
          aria-label="Resize editor and console panels"
          className="splitter"
          onPointerDown={startResize}
          type="button"
        />

        <aside
          className={`console-pane ${
            isWebProgram ? "with-preview" : "without-preview"
          }`}
          style={{ flexBasis: `${100 - split}%` }}
        >
          <section className="console-output">
            <div className="console-heading">
              <div>
                <p className="eyebrow">Output console</p>
                <h2>Runtime</h2>
              </div>
              <span>{language}</span>
            </div>
            <pre>{visibleOutput}</pre>
          </section>

          {isWebProgram && (
            <section className="preview-panel">
              <div className="console-heading">
                <div>
                  <p className="eyebrow">Combined web preview</p>
                  <h2>HTML + CSS + JavaScript</h2>
                </div>
              </div>
              <iframe
                key={webRunId}
                sandbox="allow-forms allow-modals allow-popups allow-scripts"
                srcDoc={webPreviewDoc}
                title="Combined web preview"
              />
            </section>
          )}

          <section className="collab-panel">
            <div className="console-heading">
              <div>
                <p className="eyebrow">Collaboration</p>
                <h2>Members online</h2>
              </div>
              <span>{onlineUsers.length}</span>
            </div>
            <div className="online-list">
              {onlineUsers.map((user) => (
                <span key={user.socketId}>{user.name || user.email}</span>
              ))}
              {onlineUsers.length === 0 && (
                <small>Waiting for realtime members...</small>
              )}
            </div>
            <div className="chat-feed">
              {messages.map((item, index) => (
                <p key={`${item.createdAt}-${index}`}>
                  <strong>{item.user?.name || item.user?.email}:</strong>{" "}
                  {item.message}
                </p>
              ))}
            </div>
            <div className="chat-input">
              <input
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    sendMessage();
                  }
                }}
                placeholder="Send a room note"
                value={message}
              />
              <button className="secondary-action" onClick={sendMessage}>
                Send
              </button>
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}

export default Editor;
