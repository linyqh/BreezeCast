import agents from "./agents";
import app from "./app";
import clone from "./clone";
import common from "./common";
import design from "./design";
import engine from "./engine";
import error from "./error";
import episode from "./episode";
import job from "./job";
import library from "./library";
import sample from "./sample";
import speak from "./speak";
import ui from "./ui";
import voices from "./voices";

/**
 * English is the source locale: every other locale must satisfy `Messages`
 * (inferred from this object), so a missing key is a compile error.
 *
 * Conventions
 * - Keys are grouped by feature file: `<feature>.<element>`; shared words live in `common`.
 * - Interpolation: `{{name}}`. Plurals: `_one` / `_other` suffixes (CLDR categories).
 * - Rich text uses <Trans> with named self-closing placeholders such as `<kbd/>`.
 * - `sample.*` holds default content, not UI chrome (see ./sample.ts).
 */
const en = { common, app, ui, library, episode, speak, design, clone, voices, engine, agents, job, error, sample };

export default en;
