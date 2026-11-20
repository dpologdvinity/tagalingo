/**
 * Check the shipped course content without a database and print a markdown report: exercises
 * per skill and type, then any errors and reviewer warnings. Exits 1 when there are errors.
 * CI appends the output to the job summary.
 *
 *   npm run content:check
 */
import { CONTENT_DIR } from "../src/lib/content/paths";
import { formatContentReport, loadShippedContent } from "../src/lib/content/shipped";

const report = loadShippedContent(CONTENT_DIR);
process.stdout.write(formatContentReport(report));
if (report.errors.length) process.exitCode = 1;
