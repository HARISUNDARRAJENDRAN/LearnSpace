import type { PaperCitationAnchor, StudyAnchor } from "@learnspace/shared";
import { FileText, Play } from "lucide-react";
import { formatTime } from "./time";

/** Where something sits in what is studied: a video moment, or a paper page and section. Saved records keep both forms. */
export const placeOf = (positionMs: number | null, anchor: PaperCitationAnchor | StudyAnchor | null | undefined): StudyAnchor | null =>
  anchor ?? (positionMs === null ? null : { kind: "video", positionMs });

export const placeLabel = (place: StudyAnchor) => place.kind === "video" ? formatTime(place.positionMs) : place.page ? `p. ${place.page}` : "this section";

/** "Watch at 4:10" or "Read p. 4": the action that opens a place. */
export const placeAction = (place: StudyAnchor) => `${place.kind === "video" ? "Watch at" : "Read"} ${placeLabel(place)}`;

export const PlaceIcon = ({ place }: { place: StudyAnchor }) => place.kind === "video" ? <Play aria-hidden="true" /> : <FileText aria-hidden="true" />;

/** A link-styled button that opens a place: "Watch at 4:10", "Read p. 4". */
export function PlaceLink({ place, onGo }: { place: StudyAnchor | null; onGo: (place: StudyAnchor) => void }) {
  return place ? <button className="session-link-button" type="button" onClick={() => onGo(place)}><PlaceIcon place={place} />{placeAction(place)}</button> : null;
}
