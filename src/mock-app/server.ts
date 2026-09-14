import express, { type Request, type Response, type NextFunction } from "express";
import { Store } from "./store.js";
import * as tpl from "./templates.js";

const PORT = Number(process.env.MOCK_APP_PORT ?? 4100);
const store = new Store();

const app = express();
app.use(express.urlencoded({ extended: false }));

/** Route params are always present when the route matched; this just satisfies noUncheckedIndexedAccess. */
function param(req: Request, name: string): string {
  const value = req.params[name];
  if (value === undefined) throw new Error(`missing route param ${name}`);
  return value;
}

function readSessionId(req: Request): string | undefined {
  const raw = req.headers.cookie ?? "";
  const match = raw.split(";").map((s) => s.trim()).find((s) => s.startsWith("sid="));
  return match?.slice("sid=".length);
}

function requireSession(req: Request, res: Response, next: NextFunction): void {
  const session = store.getSession(readSessionId(req));
  if (!session) {
    if (req.query.simulateTimeout === "1") {
      res.status(200).send(tpl.sessionExpiredPage());
      return;
    }
    res.redirect("/login");
    return;
  }
  next();
}

app.get("/", (_req, res) => res.redirect("/login"));

app.get("/login", (_req, res) => {
  res.status(200).send(tpl.loginPage());
});

app.post("/login", (req, res) => {
  const username = String(req.body.username ?? "").trim();
  const password = String(req.body.password ?? "").trim();
  if (!username || !password) {
    res.status(200).send(tpl.loginPage("Username and password are required."));
    return;
  }
  const session = store.createSession(username);
  res.setHeader("Set-Cookie", `sid=${session.id}; HttpOnly; Path=/`);
  res.redirect("/search");
});

app.get("/search", requireSession, (req, res) => {
  const q = String(req.query.q ?? "");
  const results = q ? store.searchMembers(q) : [];
  if (req.query.simulateInterstitial === "1" && req.query.dismissed !== "1") {
    res.status(200).send(tpl.interstitialPage(req.originalUrl.replace("simulateInterstitial=1", "simulateInterstitial=1&dismissed=1")));
    return;
  }
  res.status(200).send(tpl.searchPage(q, results));
});

app.get("/member/:id", requireSession, (req, res) => {
  const id = param(req, "id");
  const member = store.findMember(id);
  if (!member) {
    res.status(200).send(tpl.memberNotFoundPage(id));
    return;
  }
  if (member.restricted) {
    res.status(200).send(tpl.permissionDeniedPage(id));
    return;
  }
  res.status(200).send(tpl.memberDetailPage(member));
});

app.get("/member/:id/subaccount/new", requireSession, (req, res) => {
  const id = param(req, "id");
  const member = store.findMember(id);
  if (!member) {
    res.status(200).send(tpl.memberNotFoundPage(id));
    return;
  }
  res.status(200).send(tpl.newSubAccountPage(member));
});

/**
 * Renders the confirmation screen only, reads validated form state back
 * into the page, never touches the store. The store is written exactly once,
 * by POST /subaccount/create below. This is what makes the require-confirmation
 * safety boundary true by construction rather than asserted.
 */
app.post("/member/:id/subaccount/confirm", requireSession, (req, res) => {
  const id = param(req, "id");
  const member = store.findMember(id);
  if (!member) {
    res.status(200).send(tpl.memberNotFoundPage(id));
    return;
  }
  const type = String(req.body.type ?? "");
  const depositRaw = String(req.body.initialDeposit ?? "").trim();
  const deposit = Number(depositRaw);
  if (!depositRaw || Number.isNaN(deposit) || deposit <= 0) {
    res.status(200).send(
      tpl.newSubAccountPage(member, `Invalid initial deposit "${depositRaw}": enter a positive number.`),
    );
    return;
  }
  res.status(200).send(tpl.confirmSubAccountPage(member, type, deposit));
});

app.get("/subaccount-terms", (_req, res) => {
  res.status(200).send(tpl.subAccountTermsFrame());
});

/** The one and only write path for sub-account creation. */
app.post("/member/:id/subaccount/create", requireSession, (req, res) => {
  const id = param(req, "id");
  const member = store.findMember(id);
  if (!member) {
    res.status(200).send(tpl.memberNotFoundPage(id));
    return;
  }
  const type = String(req.body.type ?? "");
  const deposit = Number(req.body.initialDeposit ?? 0);
  const account = store.createSubAccount(member.id, type, deposit);
  res.status(200).send(tpl.subAccountCreatedPage(member, account.id));
});

app.post("/__test__/reset", (_req, res) => {
  store.reset();
  res.status(200).json({ reset: true });
});

if (process.env.NODE_ENV !== "test" || process.env.MOCK_APP_FORCE_LISTEN === "1") {
  app.listen(PORT, () => {
    console.log(`Mock back-office app listening on http://localhost:${PORT}`);
  });
}

export { app, store };
