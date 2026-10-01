import dotenv from 'dotenv';
import { jWT_helper } from '../helper/jwt_helper';
dotenv.config();
async function main() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const token = Buffer.concat(chunks).toString('utf8').trim().replace(/^Bearer\s+/i, '');
  const result = new jWT_helper().verifyToken(token);
  if (result.error) throw new Error(result.message);
  const { user_id, user_email, client_id, iat, exp } = result.verifiedData || {};
  console.log(JSON.stringify({ user_id, user_email, client_id, issued_at: iat, expires_at: exp }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
