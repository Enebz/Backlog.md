import type React from "react";
import type { TaskComment } from "../../types";
import { isSamePerson } from "../../utils/web-user.ts";
import { displayPerson } from "../utils/workflow";
import MermaidMarkdown from "./MermaidMarkdown";
import PersonAvatar from "./PersonAvatar";
import StoredDate from "./StoredDate";

interface CommentThreadProps {
	comments: TaskComment[];
	webUserName: string;
	theme: string;
	dateFormat?: string;
}

/** A task's comments as a conversation: who wrote each one, when, and the rendered markdown. */
const CommentThread: React.FC<CommentThreadProps> = ({ comments, webUserName, theme, dateFormat }) => {
	if (comments.length === 0) {
		return <p className="text-sm text-gray-500 dark:text-gray-400">No comments yet.</p>;
	}

	return (
		<ol className="space-y-4" aria-label="Comments">
			{comments.map((comment) => {
				const author = comment.author?.trim() ?? "";
				const isOwn = isSamePerson(author, webUserName);
				return (
					<li
						key={`${comment.index}-${comment.createdDate ?? ""}`}
						className="flex gap-3"
						data-comment-index={comment.index}
						data-comment-author={author || undefined}
					>
						<PersonAvatar name={author} webUserName={webUserName} size="md" className="mt-0.5" />
						<div className="min-w-0 flex-1">
							<div className="flex flex-wrap items-baseline gap-x-2 text-sm">
								<span
									data-comment-author-name
									className={`font-semibold ${author ? "text-gray-900 dark:text-gray-100" : "text-gray-500 dark:text-gray-400"}`}
									title={author && isOwn ? author : author ? undefined : "This comment has no author"}
								>
									{author ? displayPerson(author, webUserName) : "Unsigned"}
								</span>
								{comment.createdDate ? (
									<StoredDate
										value={comment.createdDate}
										dateFormat={dateFormat}
										age
										className="text-xs text-gray-500 dark:text-gray-400"
									/>
								) : null}
							</div>
							<div
								className={`mt-1 rounded-lg border px-3 py-2 ${
									isOwn
										? "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40"
										: "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40"
								}`}
							>
								<div className="prose prose-sm !max-w-none wmde-markdown comment-body" data-color-mode={theme}>
									<MermaidMarkdown source={comment.body} />
								</div>
							</div>
						</div>
					</li>
				);
			})}
		</ol>
	);
};

export default CommentThread;
