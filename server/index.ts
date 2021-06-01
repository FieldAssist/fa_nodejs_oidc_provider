const createError = require("http-errors");
import express, { Request, Response, urlencoded } from "express";
import { ErrorOut, errors, KoaContextWithOIDC, Provider } from "oidc-provider";
import { generators, Issuer } from 'openid-client';
import helmet from 'helmet';

const cors = require('cors');
const path = require("path");
const cookieParser = require("cookie-parser");
const logger = require("morgan");
const history = require('connect-history-api-fallback');
const body = urlencoded({ extended: false });

const app = express();

app.use(helmet());


const staticFileMiddleware = express.static(path.join(__dirname, 'dist/client'));
app.use(staticFileMiddleware);
app.use(history({
  disableDotRule: true,
  verbose: true,
  rewrites: [
    {
      from: /^\/oidc\/.*$/,
      to: function (context: any) {
        return context.parsedUrl.path;
      }
    },
    {
      from: /^\/api\/.*$/,
      to: function (context: any) {
        return context.parsedUrl.path;
      }
    }
  ]
}));
app.use(staticFileMiddleware);

app.use(logger("all"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static("public"));
app.use(cors())
const nonce = generators.nonce();

const oidc = new Provider("https://falogin.azurewebsites.net", {
  clients: [
    {
      client_id: "foo",
      client_secret: "bar",
      redirect_uris: ["https://falogin.azurewebsites.net/about", "https://fieldassistsupport.freshworks.com/sp/OIDC/318288514547605716/callback"],
      response_types: ["code", "code token", "id_token"],
      scope: 'openid email profile',
      grant_types: ['implicit', 'authorization_code'],
    },
  ],
  responseTypes: ["id_token", "code", "code token"],
  scopes: ["openid", "profile", "email"],
  formats: {
    AccessToken: 'jwt',
  },
  conformIdTokenClaims: false,
  features: {
    userinfo: {
      enabled: true,
    },
    devInteractions: {
      enabled: false,
    },
    rpInitiatedLogout: {
      enabled: true,
      postLogoutSuccessSource: async function postLogoutSuccessSource(ctx) {
        ctx.response.redirect(`/logout-success`)
      }
    }
  },
  pkce: {
    methods: [
      'S256',
    ],
    required: function pkceRequired(ctx, client) {
      return false;
    },
  },
  claims: {
    email: ['email', 'email_verified'],
  },
  async findAccount(ctx, sub, token) {
    return {
      accountId: sub,
      async claims() {
        return { sub, email: sub };
      },
    };
  },
  async extraAccessTokenClaims(ctx, token) {
    const claims = ctx.oidc.account;
    return {
      email: claims?.accountId,
    };
  },
  renderError(ctx: KoaContextWithOIDC,
              out: ErrorOut,
              error: errors.OIDCProviderError | Error,
  ) {
    console.log(out)
    console.log(error)
    ctx.response.redirect(`/error#error=${out.error}&message=${out.error_description}`)
  },
});
app.use("/oidc", oidc.callback);

app.get("/interaction/:uid", async (req, res, next) => {
  try {
    const { uid, prompt, params, session } = await oidc.interactionDetails(
      req,
      res
    );

    res.redirect('/');

    // const id: unknown = params.client_id;
    // const client11 = await oidc.Client.find(typeof id === "string" ? id : "12");
    // switch (prompt.name) {
    //   case "login": {

    //     res.render("index", { users: [] });

    //     return res.render("login", {
    //       client11,
    //       uid,
    //       details: prompt.details,
    //       params,
    //       title: "Sign-in",
    //       //session: session ? debug(session) : undefined,
    //       // dbg: {
    //       //   params: debug(params),
    //       //   prompt: debug(prompt),

    //       // },
    //     });
    //   }
    //   default:
    //     return undefined;
    // }
  } catch (err) {
    return next(err);
  }
});

oidc.Session.prototype.promptedScopesFor = () => new Set(['openid', 'email', 'profile']);

app.post(
  "/interaction/:uid/login",
  body,
  async (req, res, next) => {
    try {
      const interaction = await oidc.interactionDetails(req, res);
      console.log(interaction);
      const result = {
        login: {
          account: req.body.email,
        },
      };

      if (req.body.password !== 'abc') {
        return res.redirect('/error#error=Invalid Credentials')
      } else {
        await oidc.interactionFinished(req, res, result, {
          mergeWithLastSubmission: true,
        });
      }
    } catch (err) {
      console.error(err);
      next(err);
    }
  }
);

app.post(
  "/api/forgot-password",
  body,
  async (req, res, next) => {
    res.redirect('/password-change-success#email=' + req.body.email)
  }
);

app.get('/api/url', async (req, res, next) => {
  const host = process.env.NODE_ENV == 'production' ? 'https://falogin.azurewebsites.net' : 'http://localhost:3000'
  const issuer = await Issuer.discover(host + '/oidc')
  const client = new issuer.Client({
    client_id: 'foo',
    response_types: ['id_token', 'code'],
    redirect_uris: ['https://fieldassistsupport.freshworks.com/sp/OIDC/318288514547605716/callback']
  })

  const url = client.authorizationUrl({
    scope: 'openid email profile',
    nonce,
  });

  res.send(url);
});

// catch 404 and forward to error handler
app.use((req, res, next) => {
  next(createError(404));
});

// error handler
app.use((err: any, req: Request, res: Response, next: any) => {
  console.error(err)
  // set locals, only providing error in development
  res.locals.message = err.message ?? "Unknown Error";
  res.locals.error = req.app.get("env") === "development" ? err : {};
  // render the error page
  res.status(err.status || 500);
  // res.render("error");
  res.redirect(`/error#error=${res.locals.message}&message=${res.locals.error}`)
  // res.sendFile(path.join(__dirname + '/client/dist/index.html'));

});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`The application is listening on port ${port}!`);
});
