import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { Privacy } from "./pages/Privacy";
import { Provider } from "./pages/Provider";
import { Quality } from "./pages/Quality";
import { ThemeProvider } from "./theme";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="p/:id" element={<Provider />} />
            <Route path="qualidade" element={<Quality />} />
            <Route path="privacidade" element={<Privacy />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
