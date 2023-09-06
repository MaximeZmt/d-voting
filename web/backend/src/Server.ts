import express from 'express';
import axios, { AxiosError, Method } from 'axios';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import morgan from 'morgan';
import kyber from '@dedis/kyber';
import crypto from 'crypto';
import lmdb from 'lmdb';
import xss from 'xss';
import {
  assignUserPermissionToOwnElection,
  isAuthorized,
  PERMISSIONS,
  RevokeUserPermissionToOwnElection,
} from './authManager';
import { sessionStore } from './session';
import { authenticationRouter } from './controllers/authentication';
import { usersRouter } from './controllers/users';

const app = express();

app.use(morgan('tiny'));

const serveOnPort = process.env.PORT || 5000;
app.listen(serveOnPort);
console.log(`🚀 App is listening on port ${serveOnPort}`);

declare module 'express-session' {
  // This overrides express-session
  export interface SessionData {
    userId: number;
    firstName: string;
    lastName: string;
  }
}

// Express-session
app.set('trust-proxy', 1);

app.use(cookieParser());
const oneDay = 1000 * 60 * 60 * 24;
app.use(
  session({
    secret: process.env.SESSION_SECRET as string,
    saveUninitialized: true,
    cookie: { maxAge: oneDay },
    resave: false,
    store: sessionStore,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// This endpoint allows anyone to get a "default" proxy. Clients can still use
// the proxy of their choice thought.
app.get('/api/config/proxy', (req, res) => {
  res.status(200).send(process.env.DELA_NODE_URL);
});

// ---
// Proxies
// ---
const proxiesDB = lmdb.open<string, string>({ path: `${process.env.DB_PATH}proxies` });
app.post('/api/proxies', (req, res) => {
  if (!isAuthorized(req.session.userId, PERMISSIONS.SUBJECTS.PROXIES, PERMISSIONS.ACTIONS.POST)) {
    res.status(400).send('Unauthorized - only admins and operators allowed');
    return;
  }
  try {
    const bodydata = req.body;
    proxiesDB.put(bodydata.NodeAddr, bodydata.Proxy);
    console.log('put', bodydata.NodeAddr, '=>', bodydata.Proxy);
    res.status(200).send('ok');
  } catch (error: any) {
    res.status(500).send(error.toString());
  }
});

app.put('/api/proxies/:nodeAddr', (req, res) => {
  if (!isAuthorized(req.session.userId, PERMISSIONS.SUBJECTS.PROXIES, PERMISSIONS.ACTIONS.PUT)) {
    res.status(400).send('Unauthorized - only admins and operators allowed');
    return;
  }

  let { nodeAddr } = req.params;

  nodeAddr = decodeURIComponent(nodeAddr);

  const proxy = proxiesDB.get(nodeAddr);

  if (proxy === undefined) {
    res.status(404).send('not found');
    return;
  }
  try {
    const bodydata = req.body;
    if (bodydata.Proxy === undefined) {
      res.status(400).send('bad request, proxy is undefined');
      return;
    }

    const { NewNode } = bodydata.NewNode;
    if (NewNode !== nodeAddr) {
      proxiesDB.remove(nodeAddr);
      proxiesDB.put(NewNode, bodydata.Proxy);
    } else {
      proxiesDB.put(nodeAddr, bodydata.Proxy);
    }
    console.log('put', nodeAddr, '=>', bodydata.Proxy);
    res.status(200).send('ok');
  } catch (error: any) {
    res.status(500).send(error.toString());
  }
});

app.delete('/api/proxies/:nodeAddr', (req, res) => {
  if (!isAuthorized(req.session.userId, PERMISSIONS.SUBJECTS.PROXIES, PERMISSIONS.ACTIONS.DELETE)) {
    res.status(400).send('Unauthorized - only admins and operators allowed');
    return;
  }

  let { nodeAddr } = req.params;

  nodeAddr = decodeURIComponent(nodeAddr);

  const proxy = proxiesDB.get(nodeAddr);

  if (proxy === undefined) {
    res.status(404).send('not found');
    return;
  }

  try {
    proxiesDB.remove(nodeAddr);
    console.log('remove', nodeAddr, '=>', proxy);
    res.status(200).send('ok');
  } catch (error: any) {
    res.status(500).send(error.toString());
  }
});

app.get('/api/proxies', (req, res) => {
  const output = new Map<string, string>();
  proxiesDB.getRange({}).forEach((entry) => {
    output.set(entry.key, entry.value);
  });

  res.status(200).json({ Proxies: Object.fromEntries(output) });
});

app.get('/api/proxies/:nodeAddr', (req, res) => {
  const { nodeAddr } = req.params;

  const proxy = proxiesDB.get(decodeURIComponent(nodeAddr));

  if (proxy === undefined) {
    res.status(404).send('not found');
    return;
  }

  res.status(200).json({
    NodeAddr: nodeAddr,
    Proxy: proxy,
  });
});

// ---
// end of proxies
// ---

// get payload creates a payload with a signature on it
function getPayload(dataStr: string) {
  let dataStrB64 = Buffer.from(dataStr).toString('base64url');
  while (dataStrB64.length % 4 !== 0) {
    dataStrB64 += '=';
  }

  const hash: Buffer = crypto.createHash('sha256').update(dataStrB64).digest();

  const edCurve = kyber.curve.newCurve('edwards25519');

  const priv = Buffer.from(process.env.PRIVATE_KEY as string, 'hex');
  const pub = Buffer.from(process.env.PUBLIC_KEY as string, 'hex');

  const scalar = edCurve.scalar();
  scalar.unmarshalBinary(priv);

  const point = edCurve.point();
  point.unmarshalBinary(pub);

  const sign = kyber.sign.schnorr.sign(edCurve, scalar, hash);

  return {
    Payload: dataStrB64,
    Signature: sign.toString('hex'),
  };
}

// sendToDela signs the message and sends it to the dela proxy. It makes no
// authentication check.
function sendToDela(dataStr: string, req: express.Request, res: express.Response) {
  let payload = getPayload(dataStr);

  // we strip the `/api` part: /api/form/xxx => /form/xxx
  let uri = process.env.DELA_NODE_URL + req.baseUrl.slice(4);
  // boolean to check
  let redirectToDefaultProxy = true;
  // in case this is a DKG init request, we must also update the payload.

  const dkgInitRegex = /\/evoting\/services\/dkg\/actors$/;
  if (uri.match(dkgInitRegex)) {
    const dataStr2 = JSON.stringify({ FormID: req.body.FormID });
    payload = getPayload(dataStr2);
    redirectToDefaultProxy = false;
  }

  // in case this is a DKG setup request, we must update the payload.
  const dkgSetupRegex = /\/evoting\/services\/dkg\/actors\/.*$/;
  if (uri.match(dkgSetupRegex)) {
    const dataStr2 = JSON.stringify({ Action: req.body.Action });
    payload = getPayload(dataStr2);

    // If setup don't redirect to default proxy, if 'computePubshares' then keep
    // default proxy
    if (req.body.Action === 'setup') {
      redirectToDefaultProxy = false;
    }
  }

  // in case this is a DKG init or setup request, we must extract the proxy addr
  if (!redirectToDefaultProxy) {
    const proxy = req.body.Proxy;

    if (proxy === undefined) {
      res.status(400).send('proxy undefined in body');
      return;
    }
    uri = proxy + req.baseUrl.slice(4);
  }

  console.log('sending payload:', JSON.stringify(payload), 'to', uri);

  axios({
    method: req.method as Method,
    url: uri,
    data: payload,
    headers: {
      'Content-Type': 'application/json',
    },
  })
    .then((resp) => {
      res.status(200).send(resp.data);
    })
    .catch((error: AxiosError) => {
      let resp = '';
      if (error.response) {
        resp = JSON.stringify(error.response.data);
      }
      console.log(error);

      res
        .status(500)
        .send(`failed to proxy request: ${req.method} ${uri} - ${error.message} - ${resp}`);
    });
}

// Secure /api/evoting to admins and operators
app.put('/api/evoting/authorizations', (req, res) => {
  if (!req.session.userId) {
    res.status(400).send('Unauthorized');
    return;
  }
  if (
    !isAuthorized(req.session.userId, PERMISSIONS.SUBJECTS.ELECTION, PERMISSIONS.ACTIONS.CREATE)
  ) {
    res.status(400).send('Unauthorized');
    return;
  }
  const { FormID } = req.body;
  assignUserPermissionToOwnElection(String(req.session.userId), FormID);
});

// https://stackoverflow.com/a/1349426
function makeid(length: number) {
  let result = '';
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const charactersLength = characters.length;
  for (let i = 0; i < length; i += 1) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}
app.put('/api/evoting/forms/:formID', (req, res, next) => {
  const { formID } = req.params;
  if (!isAuthorized(req.session.userId, formID, PERMISSIONS.ACTIONS.OWN)) {
    res.status(400).send('Unauthorized');
    return;
  }
  next();
});

app.post('/api/evoting/services/dkg/actors', (req, res, next) => {
  const { FormID } = req.body;
  if (!isAuthorized(req.session.userId, FormID, PERMISSIONS.ACTIONS.OWN)) {
    res.status(400).send('Unauthorized');
    return;
  }
  if (FormID === undefined) {
    return;
  }
  next();
});
app.use('/api/evoting/services/dkg/actors/:formID', (req, res, next) => {
  const { formID } = req.params;
  if (!isAuthorized(req.session.userId, formID, PERMISSIONS.ACTIONS.OWN)) {
    res.status(400).send('Unauthorized');
    return;
  }
  next();
});
app.use('/api/evoting/services/shuffle/:formID', (req, res, next) => {
  if (!req.session.userId) {
    res.status(401).send('Unauthenticated');
    return;
  }
  const { formID } = req.params;
  if (!isAuthorized(req.session.userId, formID, PERMISSIONS.ACTIONS.OWN)) {
    res.status(400).send('Unauthorized');
    return;
  }
  next();
});
app.delete('/api/evoting/forms/:formID', (req, res) => {
  if (!req.session.userId) {
    res.status(401).send('Unauthenticated');
    return;
  }
  const { formID } = req.params;
  if (!isAuthorized(req.session.userId, formID, PERMISSIONS.ACTIONS.OWN)) {
    res.status(400).send('Unauthorized');
    return;
  }
  const edCurve = kyber.curve.newCurve('edwards25519');

  const priv = Buffer.from(process.env.PRIVATE_KEY as string, 'hex');
  const pub = Buffer.from(process.env.PUBLIC_KEY as string, 'hex');

  const scalar = edCurve.scalar();
  scalar.unmarshalBinary(priv);

  const point = edCurve.point();
  point.unmarshalBinary(pub);

  const sign = kyber.sign.schnorr.sign(edCurve, scalar, Buffer.from(formID));

  // we strip the `/api` part: /api/form/xxx => /form/xxx
  const uri = process.env.DELA_NODE_URL + xss(req.url.slice(4));

  axios({
    method: req.method as Method,
    url: uri,
    headers: {
      Authorization: sign.toString('hex'),
    },
  })
    .then((resp) => {
      res.status(200).send(resp.data);
    })
    .catch((error: AxiosError) => {
      let resp = '';
      if (error.response) {
        resp = JSON.stringify(error.response.data);
      }

      res
        .status(500)
        .send(`failed to proxy request: ${req.method} ${uri} - ${error.message} - ${resp}`);
    });
  RevokeUserPermissionToOwnElection(String(req.session.userId), formID);
});

// This API call is used redirect all the calls for DELA to the DELAs nodes.
// During this process the data are processed : the user is authenticated and
// controlled. Once this is done the data are signed before it's sent to the
// DELA node To make this work, React has to redirect to this backend all the
// request that needs to go the DELA nodes
app.use('/api/evoting/*', (req, res) => {
  if (!req.session.userId) {
    res.status(400).send('Unauthorized');
    return;
  }

  const bodyData = req.body;

  // special case for voting
  const regex = /\/api\/evoting\/forms\/.*\/vote/;
  if (req.baseUrl.match(regex)) {
    // We must set the UserID to know who this ballot is associated to. This is
    // only needed to allow users to cast multiple ballots, where only the last
    // ballot is taken into account. To preserve anonymity the web-backend could
    // translate UserIDs to another random ID.
    // bodyData.UserID = req.session.userId.toString();
    bodyData.UserID = makeid(10);
  }

  const dataStr = JSON.stringify(bodyData);

  sendToDela(dataStr, req, res);
});

app.use('', authenticationRouter);
app.use('', usersRouter);

// Handles any requests that don't match the ones above
app.get('*', (req, res) => {
  console.log('404 not found');
  const url = new URL(req.url, `http://${req.headers.host}`);
  res.status(404).send(`not found ${xss(url.toString())}`);
});
