import { body, ValidationChain } from 'express-validator';

/**
 * `AuthMiddleware` (plan §5.2). Methods return arrays of express-validator
 * chains, spread into the route middleware arrays.
 */
export class AuthMiddleware {
  public loginValidation(): ValidationChain[] {
    return [
      body('email').trim().notEmpty().withMessage('Email is required').bail().isEmail().withMessage('A valid email is required'),
      body('password').notEmpty().withMessage('Password is required'),
      body('login_type').optional().isIn([1, 2, '1', '2']).withMessage('Invalid login type'),
    ];
  }

  public generateTokenValidation(): ValidationChain[] {
    return [body('authorization_code').trim().notEmpty().withMessage('Authorization code is required')];
  }

  public regenerateTokenValidation(): ValidationChain[] {
    return [
      body('access_token').notEmpty().withMessage('Access token is required'),
      body('refresh_token').notEmpty().withMessage('Refresh token is required'),
    ];
  }

  public forgetPasswordValidation(): ValidationChain[] {
    return [
      body('email').trim().notEmpty().withMessage('Email is required').bail().isEmail().withMessage('A valid email is required'),
    ];
  }

  public verifyOtpValidation(): ValidationChain[] {
    return [
      body('email').trim().notEmpty().withMessage('Email is required').bail().isEmail().withMessage('A valid email is required'),
      body('otp').trim().notEmpty().withMessage('OTP is required').bail().isLength({ min: 4, max: 8 }).withMessage('Invalid OTP'),
    ];
  }

  public resetPasswordValidation(): ValidationChain[] {
    return [
      body('email').trim().notEmpty().withMessage('Email is required').bail().isEmail().withMessage('A valid email is required'),
      body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
      body('confirm_password').custom((value, { req }) => {
        if (value !== req.body.password) {
          throw new Error('Password and confirm password do not match');
        }
        return true;
      }),
    ];
  }
}
