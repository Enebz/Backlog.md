import { createContext, useContext } from "react";
import { DEFAULT_WEB_USER_NAME } from "../../utils/web-user.ts";

/**
 * The name of the person at the board (config `web_user_name`). Comments they post are signed with
 * it, and it is who the UI calls "You". Views rendered outside the app shell get the default.
 */
const WebUserContext = createContext<string>(DEFAULT_WEB_USER_NAME);

export const WebUserProvider = WebUserContext.Provider;

export function useWebUserName(): string {
	return useContext(WebUserContext);
}
