import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { FileSystem } from "../file-system/operations.ts";
import { BacklogServer } from "../server/index.ts";
import type { BacklogConfig, Task } from "../types/index.ts";
import { createUniqueTestDir, retry, safeCleanup } from "./test-utils.ts";

let TEST_DIR: string;
let server: BacklogServer | null = null;
let filesystem: FileSystem;
let serverPort = 0;

const baseConfig: BacklogConfig = {
	projectName: "Web Comments",
	statuses: ["To Do", "In Progress", "Waiting on you", "Done"],
	labels: [],
	dateFormat: "yyyy-mm-dd",
	remoteOperations: false,
};

const waitingTask: Task = {
	id: "TASK-1",
	title: "Decide something",
	status: "Waiting on you",
	assignee: ["@user"],
	createdDate: "2026-09-26 10:00",
	labels: ["from:depot-worker"],
	dependencies: [],
	description: "A proposal that needs a green light.",
	comments: [{ index: 1, author: "depot-worker", createdDate: "2026-09-26 10:05", body: "Session note" }],
};

async function putTask(taskId: string, body: Record<string, unknown>): Promise<Response> {
	return fetch(`http://127.0.0.1:${serverPort}/api/tasks/${taskId}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

async function putConfig(config: BacklogConfig): Promise<Response> {
	return fetch(`http://127.0.0.1:${serverPort}/api/config`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(config),
	});
}

/** The task file as it is on disk, frontmatter included. */
async function readTaskFile(): Promise<string> {
	const files = [...new Bun.Glob("backlog/tasks/*.md").scanSync({ cwd: TEST_DIR, absolute: true })];
	expect(files).toHaveLength(1);
	return Bun.file(files[0] as string).text();
}

describe("web UI comments", () => {
	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("server-web-comments");
		filesystem = new FileSystem(TEST_DIR);
		await filesystem.ensureBacklogStructure();
		await filesystem.saveConfig(baseConfig);
		await filesystem.saveTask(waitingTask);

		server = new BacklogServer(TEST_DIR);
		await server.start(0, false);
		serverPort = server.getPort() ?? 0;
		expect(serverPort).toBeGreaterThan(0);
		await retry(
			async () => {
				const response = await fetch(`http://127.0.0.1:${serverPort}/api/tasks`);
				const tasks = (await response.json()) as Task[];
				expect(tasks.length).toBeGreaterThan(0);
				return tasks;
			},
			10,
			100,
		);
	});

	afterEach(async () => {
		if (server) {
			await server.stop();
			server = null;
		}
		await safeCleanup(TEST_DIR);
	});

	it("signs a comment with the default web user name when no author is given", async () => {
		const response = await putTask(waitingTask.id, { commentsAppend: ["Looks good"] });
		expect(response.status).toBe(200);
		const updated = (await response.json()) as Task;
		expect(updated.comments?.map((comment) => comment.author)).toEqual(["depot-worker", "user"]);
		expect(updated.comments?.[1]?.body).toBe("Looks good");

		const raw = await readTaskFile();
		expect(raw).toMatch(/author: user\r?\ncreated: .+\r?\n---\r?\nLooks good\r?\n---/);
	});

	it("signs with the configured web_user_name, and keeps an explicit author", async () => {
		expect((await putConfig({ ...baseConfig, webUserName: "magnus" })).status).toBe(200);

		const signed = (await (await putTask(waitingTask.id, { commentsAppend: ["From the board"] })).json()) as Task;
		expect(signed.comments?.at(-1)?.author).toBe("magnus");

		const explicit = (await (
			await putTask(waitingTask.id, { commentsAppend: ["From a script"], commentAuthor: "@script" })
		).json()) as Task;
		expect(explicit.comments?.at(-1)?.author).toBe("@script");
	});

	it("writes a reply and a status move together in one update", async () => {
		const response = await putTask(waitingTask.id, {
			status: "In Progress",
			commentsAppend: ["Go ahead, but skip the dial"],
		});
		expect(response.status).toBe(200);
		const updated = (await response.json()) as Task;
		expect(updated.status).toBe("In Progress");
		expect(updated.comments?.at(-1)).toMatchObject({ author: "user", body: "Go ahead, but skip the dial" });

		const raw = await readTaskFile();
		expect(raw).toContain("status: In Progress");
		expect(raw).toContain("Go ahead, but skip the dial");
		// The session's comment and the rest of the task are untouched.
		expect(raw).toContain("author: depot-worker");
		expect(raw).toContain("A proposal that needs a green light.");
	});

	it("saves webUserName from the settings API and refuses one that cannot sign a comment", async () => {
		const config = (await (await fetch(`http://127.0.0.1:${serverPort}/api/config`)).json()) as BacklogConfig;

		expect((await putConfig({ ...config, webUserName: "Magnus" })).status).toBe(200);
		filesystem.invalidateConfigCache();
		expect((await filesystem.loadConfig())?.webUserName).toBe("Magnus");

		expect((await putConfig({ ...config, webUserName: "---" })).status).toBe(400);
		filesystem.invalidateConfigCache();
		expect((await filesystem.loadConfig())?.webUserName).toBe("Magnus");
	});
});
