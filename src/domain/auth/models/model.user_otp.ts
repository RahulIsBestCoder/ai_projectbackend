import { Model } from '../../../model';

/**
 * `user_otp` collection (plan §7.1). `status: 1` = active OTP, `0` = superseded.
 */
export class userOtpModel extends Model {
  constructor() {
    super(
      'user_otp',
      {
        email: { type: String, index: true },
        otp: { type: String, default: '' },
        status: { type: Number, default: 1 },
        created_at: { type: Date, default: Date.now },
      },
      { versionKey: false },
    );
  }
}
