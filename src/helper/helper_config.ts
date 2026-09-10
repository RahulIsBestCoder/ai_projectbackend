/**
 * helperConfig — HTTP status-code constants (plan §5.2 / §9). Published on
 * `global.helper_config`.
 */
export const helperConfig = {
  HTTP_STATUS_OK: 200,
  HTTP_STATUS_CREATED: 201,
  HTTP_STATUS_BAD_REQUEST: 400,
  HTTP_STATUS_UNAUTHORIZED: 401,
  HTTP_STATUS_FORBIDDEN: 403,
  HTTP_STATUS_NOT_FOUND: 404,
  HTTP_STATUS_METHOD_NOT_ALLOWED: 405,
  HTTP_STATUS_NOT_ACCEPTABLE: 406,
  HTTP_STATUS_INTERNAL_SERVER_ERROR: 500,
};

export type HelperConfig = typeof helperConfig;
