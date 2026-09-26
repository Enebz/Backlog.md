import type React from "react";
import {
	formatStoredDateAsAge,
	formatStoredDateForCompactDisplay,
	formatStoredDateForDisplay,
} from "../utils/date-display";

interface StoredDateProps {
	value?: string;
	dateFormat?: string;
	/** Dense lists render recent values relatively ("today", "3d ago"). */
	compact?: boolean;
	/** Conversations render the last day in minutes and hours ("5 min ago"). */
	age?: boolean;
	className?: string;
}

/**
 * Renders a stored UTC date as local time with the canonical UTC value on hover.
 * Every web surface showing a stored date goes through this, so no component converts on its own.
 */
const StoredDate: React.FC<StoredDateProps> = ({ value, dateFormat, compact = false, age = false, className }) => {
	const { text, title } = age
		? formatStoredDateAsAge(value, { dateFormat })
		: compact
			? formatStoredDateForCompactDisplay(value, { dateFormat })
			: formatStoredDateForDisplay(value, { dateFormat });

	return (
		<span className={className} title={title}>
			{text}
		</span>
	);
};

export default StoredDate;
