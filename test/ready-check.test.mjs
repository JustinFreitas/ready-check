import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    escapeHtml,
    getDialogClasses,
    setAllToNotReady,
    displayGmDialog,
    displayStatusUpdateDialog,
    displayReadyCheckDialog,
    displayReadyCheckChatMessage,
    displayStatusUpdateChatMessage,
    updatePlayersWindow,
} from "../ready-check.js";

class MockDialogV2 {
    static instances = [];
    constructor(options) {
        this.options = options;
        this.rendered = false;
        this.renderArgs = null;
        this.listeners = new Map();
        MockDialogV2.instances.push(this);
    }
    addEventListener(type, fn) {
        this.listeners.set(type, fn);
    }
    render(options) {
        this.rendered = true;
        this.renderArgs = options;
        return this;
    }
}

class MockElement {
    constructor(tagName = "div", ownerDocument = null) {
        this.tagName = tagName.toUpperCase();
        this.ownerDocument = ownerDocument;
        this.id = "";
        this.dataset = {};
        this.attributes = new Map();
        this.children = [];
        const classes = new Set();
        this._classes = classes;
        this.classList = {
            add: (...cls) => cls.forEach((c) => c && classes.add(c)),
            remove: (...cls) => cls.forEach((c) => classes.delete(c)),
            contains: (c) => classes.contains ? classes.contains(c) : classes.has(c),
        };
    }
    get className() {
        return [...this._classes].join(" ");
    }
    set className(val) {
        this._classes.clear();
        String(val)
            .split(/\s+/)
            .filter(Boolean)
            .forEach((c) => this._classes.add(c));
    }
    setAttribute(k, v) {
        this.attributes.set(k, String(v));
        if (k === "data-user-id") this.dataset.userId = String(v);
    }
    getAttribute(k) {
        return this.attributes.get(k) ?? null;
    }
    hasAttribute(k) {
        return this.attributes.has(k);
    }
    removeAttribute(k) {
        this.attributes.delete(k);
    }
    appendChild(child) {
        child.parent = this;
        this.children.push(child);
        return child;
    }
    remove() {
        if (this.parent) {
            this.parent.children = this.parent.children.filter((c) => c !== this);
        }
    }
    querySelectorAll(selector) {
        const results = [];
        const match = (el) => {
            if (selector === "#players") return el.id === "players";
            if (selector === "#players-inactive") return el.id === "players-inactive";
            if (selector === ".crash-ready-indicator") return el._classes.has("crash-ready-indicator");
            const userMatch = selector.match(/^\[data-user-id="(.+)"\]$/);
            if (userMatch) return el.dataset.userId === userMatch[1];
            return false;
        };
        const walk = (node) => {
            for (const child of node.children) {
                if (match(child)) results.push(child);
                walk(child);
            }
        };
        walk(this);
        return results;
    }
    querySelector(selector) {
        return this.querySelectorAll(selector)[0] ?? null;
    }
}

function makePlayersDom(userIds) {
    const doc = {
        createElement: (tag) => new MockElement(tag, doc),
    };
    const root = new MockElement("section", doc);
    root.id = "players";
    const inactive = new MockElement("div", doc);
    inactive.id = "players-inactive";
    inactive.classList.add("scrollable");
    root.appendChild(inactive);
    for (const id of userIds) {
        const li = new MockElement("li", doc);
        li.setAttribute("data-user-id", id);
        root.appendChild(li);
    }
    return { root, inactive };
}

beforeEach(() => {
    MockDialogV2.instances = [];
    globalThis.foundry = {
        applications: {
            api: { DialogV2: MockDialogV2 },
            instances: new Map(),
        },
        utils: {},
    };
    globalThis.ui = {
        players: {
            renderCalls: [],
            render(opts) {
                this.renderCalls.push(opts);
            },
        },
        windows: {},
    };
    globalThis.game = {
        system: { id: "ose" },
        user: { id: "gm1", isGM: true },
        i18n: { localize: (k) => k },
        socket: {
            emitted: [],
            emit(channel, payload) {
                this.emitted.push({ channel, payload });
            },
        },
        settings: {
            get: () => true,
        },
        users: {
            contents: [
                { id: "u1", name: 'Alice <"Rogue">', ready: true, getFlag: function () { return this.ready; } },
                { id: "u2", name: "Bob & Co", ready: false, getFlag: function () { return this.ready; } },
            ],
            get(id) {
                return this.contents.find((u) => u.id === id);
            },
        },
    };
    globalThis.ChatMessage = {
        created: [],
        create(msg) {
            this.created.push(msg);
        },
    };
});

test("DialogV2 dialogs include OSE + dialog classes, position, and { force: true } render", () => {
    displayGmDialog();
    displayStatusUpdateDialog();
    displayReadyCheckDialog();

    assert.equal(MockDialogV2.instances.length, 3);
    for (const dlg of MockDialogV2.instances) {
        assert.ok(dlg.options.classes.includes("ose"));
        assert.ok(dlg.options.classes.includes("dialog"));
        assert.deepEqual(dlg.options.position, { width: 360, height: "auto" });
        assert.deepEqual(dlg.renderArgs, { force: true });
        for (const btn of dlg.options.buttons) {
            assert.equal(typeof btn.action, "string");
            assert.ok(btn.action.length > 0);
        }
    }

    globalThis.game.system.id = "dnd5e";
    assert.deepEqual(getDialogClasses(), ["dialog", "ready-check-dialog"]);
});

test("updatePlayersWindow is synchronous, idempotent, deduplicates icons, and avoids native title attribute", () => {
    const { root, inactive } = makePlayersDom(["u1", "u2"]);

    // Simulate overlapping invocations
    updatePlayersWindow(root);
    updatePlayersWindow(root);

    assert.equal(inactive.classList.contains("scrollable"), false);
    const u1Row = root.querySelector('[data-user-id="u1"]');
    const u2Row = root.querySelector('[data-user-id="u2"]');
    assert.equal(u1Row.querySelectorAll(".crash-ready-indicator").length, 1);
    assert.equal(u2Row.querySelectorAll(".crash-ready-indicator").length, 1);

    const u1Icon = u1Row.querySelector(".crash-ready-indicator");
    assert.equal(u1Icon.classList.contains("ready"), true);
    assert.equal(u1Icon.classList.contains("fa-check"), true);
    assert.equal(u1Icon.hasAttribute("title"), false);
    assert.equal(u1Icon.getAttribute("data-tooltip"), "READYCHECK.PlayerReady");
    assert.equal(u1Icon.getAttribute("aria-label"), "READYCHECK.PlayerReady");

    // Flip u1 to not ready and ensure existing indicator updates cleanly (and strips any pre-existing title/duplicate)
    u1Icon.setAttribute("title", "stale");
    const extraDup = root.ownerDocument.createElement("i");
    extraDup.className = "fas fa-check crash-ready-indicator ready";
    u1Row.appendChild(extraDup);
    globalThis.game.users.contents[0].ready = false;

    updatePlayersWindow(root);
    assert.equal(u1Row.querySelectorAll(".crash-ready-indicator").length, 1);
    assert.equal(u1Icon.classList.contains("not-ready"), true);
    assert.equal(u1Icon.classList.contains("ready"), false);
    assert.equal(u1Icon.hasAttribute("title"), false);
    assert.equal(u1Icon.getAttribute("data-tooltip"), "READYCHECK.PlayerNotReady");
});

test("setAllToNotReady batches updates via User.updateDocuments and refreshes GM player list", async () => {
    const updates = [];
    globalThis.User = {
        async updateDocuments(docs) {
            updates.push(docs);
        },
    };

    await setAllToNotReady();

    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0], [
        { _id: "u1", "flags.ready-check.isReady": false },
        { _id: "u2", "flags.ready-check.isReady": false },
    ]);
    assert.deepEqual(globalThis.ui.players.renderCalls, [{ force: true }]);
    assert.equal(globalThis.game.socket.emitted.length, 1);
    assert.equal(globalThis.game.socket.emitted[0].payload.action, "player-render");
});

test("chat messages HTML-escape usernames", () => {
    assert.equal(escapeHtml('Alice <"Rogue"> & Bob'), "Alice &lt;&quot;Rogue&quot;&gt; &amp; Bob");

    displayReadyCheckChatMessage({ userId: "u1", ready: true });
    displayStatusUpdateChatMessage({ userId: "u2", ready: false });

    assert.equal(globalThis.ChatMessage.created.length, 2);
    assert.match(globalThis.ChatMessage.created[0].content, /^Alice &lt;&quot;Rogue&quot;&gt; /);
    assert.match(globalThis.ChatMessage.created[1].content, /^Bob &amp; Co /);
});
