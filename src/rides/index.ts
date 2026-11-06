import { Coaster } from "../world/coaster";
import { FerrisWheel } from "../world/ferris";
import { Carousel } from "../world/carousel";
import { DropTower } from "../world/droptower";
import { BumperCars } from "../world/bumpers";
import { PirateShip } from "../world/pirateship";
import { SwingRide } from "../world/swings";
import { Teacups } from "../world/teacups";
import { coasterRide } from "./coaster";
import { wheelRide } from "./wheel";
import { carouselRide } from "./carousel";
import { dropRide } from "./drop";
import { bumperRide } from "./bumper";
import { shipRide } from "./ship";
import { swingRide } from "./swing";
import { teacupRide } from "./teacup";
import type { RideDef, RideEnv } from "./types";

export type { Ride, RideDef, RideEnv, RideResult, RemoteView } from "./types";

/** Every seated ride in the park. New ride: add its world object + def here. */
export function buildRides(env: RideEnv) {
  const world = {
    coaster: new Coaster(),
    wheel: new FerrisWheel(70, -70),
    carousel: new Carousel(58, 18),
    tower: new DropTower(0, -40),
    bumpers: new BumperCars(54, 52),
    ship: new PirateShip(-64, -24),
    swings: new SwingRide(70, -34),
    teacups: new Teacups(-33, 49),
  };
  const list: RideDef[] = [
    coasterRide(env, world.coaster),
    wheelRide(env, world.wheel),
    carouselRide(env, world.carousel),
    dropRide(env, world.tower),
    bumperRide(env, world.bumpers),
    shipRide(env, world.ship),
    swingRide(env, world.swings),
    teacupRide(env, world.teacups),
  ];
  const byKind = new Map(list.map((d) => [d.kind, d]));
  return { list, byKind, world };
}
