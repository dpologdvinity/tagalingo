/** Filesystem locations of the shipped course content. */
import path from "node:path";

export const CONTENT_DIR = path.join(process.cwd(), "content", "tagalog");
export const COURSE_FILE = path.join(CONTENT_DIR, "course.yaml");
