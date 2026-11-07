import type { Locale } from "../../types";
import type en from "../en";
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

const zhCN: Locale<typeof en> = { common, app, ui, library, episode, speak, design, clone, voices, engine, agents, job, error, sample };

export default zhCN;
