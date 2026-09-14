export interface SubAccount {
  id: string;
  type: string;
  balance: number;
}

export interface Member {
  id: string;
  name: string;
  savingsBalance: number;
  restricted: boolean;
  subAccounts: SubAccount[];
}

export interface Session {
  id: string;
  username: string;
}

/**
 * Plain in-memory store, reseeded to a fixed set of fixtures on every process
 * start. No persistence layer: restarting the mock app is the reset mechanism,
 * so discovery, replay, replay-with-injected-error, and the test suite each
 * get a clean, reproducible starting state without a migration/seed script.
 */
export class Store {
  members = new Map<string, Member>();
  sessions = new Map<string, Session>();
  private subAccountCounter = 0;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.members.clear();
    this.sessions.clear();
    this.subAccountCounter = 0;
    for (const m of seedMembers()) {
      this.members.set(m.id, m);
    }
  }

  findMember(id: string): Member | undefined {
    return this.members.get(id);
  }

  searchMembers(query: string): Member[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return [...this.members.values()].filter(
      (m) => m.id === q || m.name.toLowerCase().includes(q),
    );
  }

  createSession(username: string): Session {
    const id = `sess_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    const session = { id, username };
    this.sessions.set(id, session);
    return session;
  }

  getSession(id: string | undefined): Session | undefined {
    if (!id) return undefined;
    return this.sessions.get(id);
  }

  /**
   * The single write path for sub-account creation. Called only by the final
   * "Confirm & Create" submit, never by rendering the confirmation screen.
   * This is what makes the require-confirmation safety boundary true by
   * construction: reaching confirmation never touches this method.
   */
  createSubAccount(memberId: string, type: string, initialDeposit: number): SubAccount {
    const member = this.members.get(memberId);
    if (!member) throw new Error(`createSubAccount: unknown member ${memberId}`);
    this.subAccountCounter += 1;
    const account: SubAccount = {
      id: `SA-${this.subAccountCounter}`,
      type,
      balance: initialDeposit,
    };
    member.subAccounts.push(account);
    return account;
  }
}

function seedMembers(): Member[] {
  return [
    {
      id: "10023",
      name: "Dana Whitfield",
      savingsBalance: 4210.55,
      restricted: false,
      subAccounts: [],
    },
    {
      id: "10045",
      name: "Marcus Boyle",
      savingsBalance: 812.1,
      restricted: false,
      subAccounts: [],
    },
    {
      id: "20099",
      name: "Priya Anand",
      savingsBalance: 15032.0,
      restricted: false,
      subAccounts: [{ id: "SA-0", type: "Holiday Club", balance: 500 }],
    },
    {
      id: "90001",
      name: "Restricted Test Account",
      savingsBalance: 0,
      restricted: true,
      subAccounts: [],
    },
  ];
}
