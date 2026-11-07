import { alerts } from "./alerts.js";
import { cargo } from "./cargo.js";
import { heading } from "./heading.js";
import { here } from "./here.js";
import { map } from "./map.js";
import { route } from "./route.js";
import { team } from "./team.js";
import { trade } from "./trade.js";

// One widget per type for now. Order = order in the "Add widget" list.
export const WIDGETS = [route, cargo, team, trade, heading, here, map, alerts];
