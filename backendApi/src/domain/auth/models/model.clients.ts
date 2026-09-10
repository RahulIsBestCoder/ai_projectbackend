import { Model } from '../../../model';

/** `clients` collection (plan §14.1). The `Web` client drives the auth-code step. */
export class clientsModel extends Model {
  constructor() {
    super(
      'clients',
      {
        client_id: { type: String, index: true },
        client_name: { type: String, index: true },
        client_secret: { type: String, default: '' },
        redirect_url: { type: String, default: '' },
        status: { type: Number, default: 1 },
        created_at: { type: Date, default: Date.now },
      },
      { versionKey: false },
    );
  }
}
