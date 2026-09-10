import dotenv from 'dotenv';

dotenv.config();

import path from 'path';
import express, { Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { Mongoose } from 'mongoose';

import { Connection } from './configuration/config';
import { LOGGER_SETTINGS } from './configuration/log_config';
import { winstonlog } from './configuration/winston';
import { Encryption } from './helper/encrypt_decrypt_helper';
import { common_helper } from './helper/common_helper';
import { common_middleware } from './helper/common_middleware';
import { helperConfig } from './helper/helper_config';

/**
 * Global service locator (plan §1 / §3 / §16.1). Cross-cutting singletons live
 * on Node `global` and are typed here.
 */
declare global {
  // eslint-disable-next-line no-var, vars-on-top
  var db: Mongoose;
  // eslint-disable-next-line no-var, vars-on-top
  var Helpers: common_helper;
  // eslint-disable-next-line no-var, vars-on-top
  var logs: winstonlog;
  // eslint-disable-next-line no-var, vars-on-top
  var helper_config: typeof helperConfig;
  // eslint-disable-next-line no-var, vars-on-top
  var path: string;
  // eslint-disable-next-line no-var, vars-on-top
  var encrypt_decrypt_helper: Encryption;
}

async function bootstrap(): Promise<void> {
  // 1. DB connection (failure is logged, process still starts)
  global.db = await new Connection().connect();

  // 2-3. cross-cutting singletons onto global
  const winlog = new winstonlog(LOGGER_SETTINGS);
  global.logs = winlog;
  global.encrypt_decrypt_helper = new Encryption();
  global.Helpers = new common_helper();
  global.helper_config = helperConfig;
  global.path = __dirname;

  const app = express();
  const commonMiddleware = new common_middleware();

  // 4. HTTP logs -> winston
  app.use(morgan('combined', { stream: { write: (msg: string) => global.logs.logger.info(msg.trim()) } }));

  // 5. security headers
  app.use(helmet());
  app.use(helmet.contentSecurityPolicy({ directives: { defaultSrc: ["'none'"] } }));
  app.use(helmet.frameguard({ action: 'deny' }));

  // 6. parsers, static, views
  app.use(cookieParser());
  app.use(express.json({ limit: '150mb' }));
  app.use(express.urlencoded({ limit: '150mb', extended: true }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  // 7. CORS
  app.use(cors({ origin: '*', optionsSuccessStatus: 200 }));

  // 8. global request-body decryption (envelope encryption)
  app.use(commonMiddleware.decryptFromdata);

  // 9. domain routes
  // Loaded lazily (require, not top-level import) so that every eager singleton
  // created at route-module load time — controllers -> services -> models — sees
  // an already-populated `global` service locator (plan §12 item 9).
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  const app_route = require('./app_routing').default;
  app.use('/v1', app_route);

  // 10. logging system + root page
  winlog.initiateLoggingSystem();
  app.get('/', (_req: Request, res: Response) => res.render('error'));

  // 11. listen
  const port = process.env.PORT || 3000;
  app.listen(port, () => global.logs.writelog('app', `server listening on port ${port}`, 'INFO'));
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('fatal bootstrap error:', err);
  process.exit(1);
});
