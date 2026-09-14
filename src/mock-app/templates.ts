import type { Member } from "./store.js";

/**
 * Deliberately hostile styling/structure (table-based layout, deeply nested
 * markup, no data-testid attributes) but built from native semantic HTML
 * elements throughout (real <table>/<button>/<input>/<label>) so the
 * accessibility tree carries real role/accessible-name signal. This mirrors
 * the real target domain: legacy enterprise apps are usually bad HTML, not
 * deliberately anti-accessible custom widgets.
 */
function page(title: string, body: string): string {
  return `<!doctype html>
<html>
<head><title>${escape(title)}</title></head>
<body bgcolor="#ECECEC">
<table width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr><td>
    <table cellpadding="4" cellspacing="0" border="1" width="100%">
      <tr><td bgcolor="#003366"><font color="white" face="Arial" size="4">Member Services Console</font></td></tr>
    </table>
  </td></tr>
  <tr><td>
    <table cellpadding="10" cellspacing="0" border="0" width="100%">
      <tr><td>
        ${body}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function loginPage(error?: string): string {
  return page(
    "Login",
    `
    <table cellpadding="6" cellspacing="0" border="0">
      <tr><td colspan="2"><font face="Arial" size="3"><b>Sign in</b></font></td></tr>
      ${error ? `<tr><td colspan="2"><font color="red">${escape(error)}</font></td></tr>` : ""}
      <form method="POST" action="/login">
        <tr>
          <td><label for="username">Username</label></td>
          <td><input type="text" id="username" name="username" /></td>
        </tr>
        <tr>
          <td><label for="password">Password</label></td>
          <td><input type="password" id="password" name="password" /></td>
        </tr>
        <tr><td colspan="2"><button type="submit">Sign in</button></td></tr>
      </form>
    </table>
  `,
  );
}

export function searchPage(query: string, results: Member[]): string {
  const rows = results
    .map(
      (m) => `
      <tr>
        <td>${escape(m.name)}</td>
        <td>${escape(m.id)}</td>
        <td><a href="/member/${encodeURIComponent(m.id)}">View</a></td>
      </tr>`,
    )
    .join("");
  return page(
    "Search Members",
    `
    <table cellpadding="6" cellspacing="0" border="0">
      <tr><td colspan="2"><font face="Arial" size="3"><b>Search Members</b></font></td></tr>
      <form method="GET" action="/search">
        <tr>
          <td><label for="q">Member name or ID</label></td>
          <td><input type="text" id="q" name="q" value="${escape(query)}" /></td>
        </tr>
        <tr><td colspan="2"><button type="submit">Search</button></td></tr>
      </form>
    </table>
    <table cellpadding="6" cellspacing="0" border="1" width="100%">
      <tr><th>Name</th><th>Member ID</th><th></th></tr>
      ${rows || (query ? `<tr><td colspan="3"><i>No results found for "${escape(query)}"</i></td></tr>` : `<tr><td colspan="3"><i>Enter a name or ID to search</i></td></tr>`)}
    </table>
  `,
  );
}

export function memberDetailPage(member: Member): string {
  const subRows = member.subAccounts
    .map((s) => `<tr><td>${escape(s.id)}</td><td>${escape(s.type)}</td><td>$${s.balance.toFixed(2)}</td></tr>`)
    .join("");
  return page(
    `Member ${member.id}`,
    `
    <table cellpadding="6" cellspacing="0" border="0">
      <tr><td colspan="2"><font face="Arial" size="3"><b>${escape(member.name)}</b></font></td></tr>
      <tr><td>Member ID</td><td>${escape(member.id)}</td></tr>
      <tr><td>Savings Balance</td><td>$${member.savingsBalance.toFixed(2)}</td></tr>
    </table>
    <table cellpadding="6" cellspacing="0" border="1" width="100%">
      <tr><th>Sub-Account ID</th><th>Type</th><th>Balance</th></tr>
      ${subRows || `<tr><td colspan="3"><i>No sub-accounts</i></td></tr>`}
    </table>
    <p><a href="/member/${encodeURIComponent(member.id)}/subaccount/new"><button type="button" onclick="location.href=this.form">Open New Sub-Account</button></a></p>
    <p><a href="/search">Back to search</a></p>
  `,
  );
}

export function memberNotFoundPage(id: string): string {
  return page(
    "Member Not Found",
    `<table cellpadding="6"><tr><td><font face="Arial"><b>No such member.</b></font></td></tr>
     <tr><td>No member matches ID "${escape(id)}".</td></tr>
     <tr><td><a href="/search">Back to search</a></td></tr></table>`,
  );
}

export function permissionDeniedPage(id: string): string {
  return page(
    "Access Denied",
    `<table cellpadding="6"><tr><td><font face="Arial" color="red"><b>Access denied.</b></font></td></tr>
     <tr><td>You do not have permission to view member ${escape(id)}.</td></tr>
     <tr><td><a href="/search">Back to search</a></td></tr></table>`,
  );
}

export function sessionExpiredPage(): string {
  return page(
    "Session Expired",
    `<table cellpadding="6"><tr><td><font face="Arial" color="red"><b>Your session has expired.</b></font></td></tr>
     <tr><td><a href="/login">Log in again</a></td></tr></table>`,
  );
}

export function interstitialPage(continueUrl: string): string {
  return page(
    "System Notice",
    `<table cellpadding="6"><tr><td><font face="Arial"><b>Scheduled maintenance notice.</b></font></td></tr>
     <tr><td>This system will be briefly unavailable this weekend.</td></tr>
     <form method="GET" action="${escape(continueUrl)}">
       <input type="hidden" name="dismissed" value="1" />
       <tr><td><button type="submit">Continue</button></td></tr>
     </form></table>`,
  );
}

export function newSubAccountPage(member: Member, error?: string): string {
  return page(
    "Open New Sub-Account",
    `
    <table cellpadding="6" cellspacing="0" border="0">
      <tr><td colspan="2"><font face="Arial" size="3"><b>Open New Sub-Account for ${escape(member.name)}</b></font></td></tr>
      ${error ? `<tr><td colspan="2"><font color="red">${escape(error)}</font></td></tr>` : ""}
      <form method="POST" action="/member/${encodeURIComponent(member.id)}/subaccount/confirm">
        <tr>
          <td><label for="type">Account type</label></td>
          <td>
            <select id="type" name="type">
              <option value="Holiday Club">Holiday Club</option>
              <option value="Emergency Fund">Emergency Fund</option>
            </select>
          </td>
        </tr>
        <tr>
          <td><label for="initialDeposit">Initial deposit ($)</label></td>
          <td><input type="text" id="initialDeposit" name="initialDeposit" /></td>
        </tr>
        <tr><td colspan="2"><button type="submit">Continue</button></td></tr>
      </form>
    </table>
  `,
  );
}

export function confirmSubAccountPage(member: Member, type: string, initialDeposit: number): string {
  return page(
    "Confirm New Sub-Account",
    `
    <table cellpadding="6" cellspacing="0" border="0">
      <tr><td colspan="2"><font face="Arial" size="3"><b>Confirm New Sub-Account</b></font></td></tr>
      <tr><td>Member</td><td>${escape(member.name)} (${escape(member.id)})</td></tr>
      <tr><td>Account type</td><td>${escape(type)}</td></tr>
      <tr><td>Initial deposit</td><td>$${initialDeposit.toFixed(2)}</td></tr>
    </table>
    <table cellpadding="6"><tr><td>
      <iframe src="/subaccount-terms" width="400" height="120" frameborder="1"></iframe>
    </td></tr></table>
    <form method="POST" action="/member/${encodeURIComponent(member.id)}/subaccount/create">
      <input type="hidden" name="type" value="${escape(type)}" />
      <input type="hidden" name="initialDeposit" value="${initialDeposit}" />
      <table cellpadding="6"><tr>
        <td><button type="submit">Confirm &amp; Create</button></td>
        <td><a href="/member/${encodeURIComponent(member.id)}">Cancel</a></td>
      </tr></table>
    </form>
  `,
  );
}

export function subAccountTermsFrame(): string {
  return `<!doctype html><html><body><p style="font-family: Arial; font-size: 11px;">
    Standard sub-account terms: funds are held in a linked ledger and may be
    withdrawn to the primary savings account at any time without penalty.
  </p></body></html>`;
}

export function subAccountCreatedPage(member: Member, subAccountId: string): string {
  return page(
    "Sub-Account Created",
    `<table cellpadding="6"><tr><td><font face="Arial"><b>Sub-account ${escape(subAccountId)} created.</b></font></td></tr>
     <tr><td><a href="/member/${encodeURIComponent(member.id)}">Back to member</a></td></tr></table>`,
  );
}
