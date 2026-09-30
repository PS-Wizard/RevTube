/**
 * Standard error handler for YouTube API errors.
 * Used by all route handlers to produce consistent error responses.
 */
function handleApiError(error, res) {
  if (error.response) {
    const { status, data, config } = error.response;
    console.error("YouTube API Error:", {
      status,
      message: data?.error?.message || "Internal Error",
      url: config?.url,
      params: config?.params,
      responseBody: JSON.stringify(data).slice(0, 500),
    });
    res.status(status).json(data);
  } else if (error.request) {
    const method = error.request.method || "GET";
    const url = error.request._currentUrl || "(unknown)";
    console.error("YouTube API - No Response:", {
      method,
      url,
      message: error.message,
      code: error.code,
      errno: error.errno,
      syscall: error.syscall,
    });
    res
      .status(500)
      .json({ error: { message: "No response received from YouTube API" } });
  } else {
    console.error("YouTube API - Request Config Error:", error.message);
    res.status(500).json({ error: { message: error.message } });
  }
}

module.exports = { handleApiError };
