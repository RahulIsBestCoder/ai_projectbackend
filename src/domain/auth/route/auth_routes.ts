import express, { Request, Response } from 'express';
import { AuthController } from '../controller/auth_controller';
import { AuthMiddleware } from '../middleware/auth_middleware';
import { common_middleware } from '../../../helper/common_middleware';

/**
 * auth router (plan §5.1 / §14.1). Mounted at `/v1/user`.
 * All endpoints are POST; auth endpoints deliberately omit `validateToken`.
 * Every route ends with `.all(methodNotAllowed)` -> 405 for any other verb.
 */
const router = express.Router();
const controller = new AuthController();
const authMiddleware = new AuthMiddleware();
const commonMiddleware = new common_middleware();

const methodNotAllowed = (_req: Request, res: Response) =>
  global.Helpers.methodNotAllowedStatusBuild(res, 'Method not allowed');

router
  .route('/login')
  .post(
    [commonMiddleware.validateFormData, ...authMiddleware.loginValidation(), commonMiddleware.checkforerrors],
    controller.loginController,
  )
  .all(methodNotAllowed);

router
  .route('/generateToken')
  .post(
    [commonMiddleware.validateFormData, ...authMiddleware.generateTokenValidation(), commonMiddleware.checkforerrors],
    controller.generateToken,
  )
  .all(methodNotAllowed);

router
  .route('/regenerateToken')
  .post(
    [commonMiddleware.validateFormData, ...authMiddleware.regenerateTokenValidation(), commonMiddleware.checkforerrors],
    controller.reGenerateToken,
  )
  .all(methodNotAllowed);

router
  .route('/forgotPassword')
  .post(
    [commonMiddleware.validateFormData, ...authMiddleware.forgetPasswordValidation(), commonMiddleware.checkforerrors],
    controller.forgetPassword,
  )
  .all(methodNotAllowed);

router
  .route('/verifyOtp')
  .post(
    [commonMiddleware.validateFormData, ...authMiddleware.verifyOtpValidation(), commonMiddleware.checkforerrors],
    controller.verifyOtp,
  )
  .all(methodNotAllowed);

router
  .route('/resetPassword')
  .post(
    [commonMiddleware.validateFormData, ...authMiddleware.resetPasswordValidation(), commonMiddleware.checkforerrors],
    controller.resetPassword,
  )
  .all(methodNotAllowed);

export const auth_routing = router;
export default router;
