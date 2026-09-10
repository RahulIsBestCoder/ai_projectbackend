import { Model } from '../../../model';

/**
 * `invalid_emails` collection (plan §11, §13). Bounce / complaint / unsubscribe
 * list; gates outbound SES sends.
 */
export class invalidEmailsModel extends Model {
  constructor() {
    super(
      'invalid_emails',
      {
        email: { type: String, index: true },
        type: { type: String, default: '' }, // bounce | complaint | unsubscribe
        created_at: { type: Date, default: Date.now },
      },
      { versionKey: false },
    );
  }

  public countAllByOR(email: string) {
    return this.Model.countDocuments({
      email,
      type: { $in: ['bounce', 'complaint', 'unsubscribe'] },
    });
  }
}
