const JUDGE0_API_URL = process.env.JUDGE0_API_URL || "https://ce.judge0.com";
const JUDGE0_API_KEY = process.env.JUDGE0_API_KEY || "";
const JUDGE0_AUTH_HEADER = process.env.JUDGE0_AUTH_HEADER || "X-Auth-Token";

const LANGUAGE_IDS = {
  javascript: 102,
  python: 109,
  cpp: 105,
  java: 91,
};

const getJudge0Url = (path) =>
  `${JUDGE0_API_URL.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;

const getHeaders = () => ({
  "Content-Type": "application/json",
  ...(JUDGE0_API_KEY ? { [JUDGE0_AUTH_HEADER]: JUDGE0_API_KEY } : {}),
});

const requestJson = async (url, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || data.message || "Code execution API failed");
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
};

const formatOutput = (result) => {
  const parts = [
    result.compile_output,
    result.stdout,
    result.stderr,
    result.message,
  ].filter(Boolean);

  if (parts.length > 0) {
    return parts.join("\n");
  }

  if (result.status?.description && result.status.description !== "Accepted") {
    return result.status.description;
  }

  return "Program finished with no output";
};

exports.runCode = async (req, res) => {
  const code = String(req.body.code || "");
  const language = String(req.body.language || "").toLowerCase().trim();

  if (!code.trim()) {
    return res.json({ output: "No code provided" });
  }

  if (language === "html" || language === "css") {
    return res.json({ output: "Preview refreshed in the browser." });
  }

  const languageId = LANGUAGE_IDS[language];

  if (!languageId) {
    return res.json({ output: "Language not supported yet" });
  }

  try {
    const result = await requestJson(
      getJudge0Url("/submissions?base64_encoded=false&wait=true"),
      {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          language_id: languageId,
          source_code: code,
          stdin: "",
          cpu_time_limit: 5,
          wall_time_limit: 10,
        }),
      }
    );

    return res.json({
      output: formatOutput(result),
      runtime: {
        language,
        status: result.status?.description,
      },
    });
  } catch (error) {
    return res.json({
      output:
        error.name === "AbortError"
          ? "Cloud execution timed out"
          : `Cloud execution failed: ${error.message}`,
    });
  }
};
