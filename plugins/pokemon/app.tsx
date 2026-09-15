import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { CatchOverlay } from "@/components/catch-overlay";
import { PokedexPage } from "@/components/pokedex-page";
import { ProgressAccessory } from "@/components/progress-accessory";
import { POKEDEX_PATH } from "@/lib/routes";
import "./app.css";

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({
    id: "catch",
    component: CatchOverlay,
  });
  app.slots.navPanel({
    id: "pokedex",
    title: "Pokédex",
    icon: "GridView",
    path: POKEDEX_PATH,
    component: PokedexPage,
    experimental_sidebarAccessory: ProgressAccessory,
  });
});
