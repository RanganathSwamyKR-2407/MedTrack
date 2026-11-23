export class AppError extends Error {
  constructor(statusCode, code, message, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function apiNotFoundHandler(req, res) {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: `API endpoint ${req.method} ${req.originalUrl} does not exist.`
    }
  });
}

export function errorHandler(err, _req, res, _next) {
  const statusCode = err.statusCode || 500;
  const code = err.code || (statusCode === 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR");
  if (statusCode >= 500) {
    console.error("[MedTrack API Error]", err);
  }
  res.status(statusCode).json({
    error: {
      code,
      message: err.message || "An unexpected error occurred.",
      ...(err.details ? { details: err.details } : {})
    }
  });
}
