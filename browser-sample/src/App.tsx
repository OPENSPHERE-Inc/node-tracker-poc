import React from 'react';
import {BrowserRouter, Route, Routes} from "react-router-dom";
import Index from "./pages/Index";

function App() {
  return (
      <section className="section">
          <div className="container is-max-desktop">
              <BrowserRouter>
                  <Routes>
                      <Route path="/" element={<Index />} />
                  </Routes>
              </BrowserRouter>
          </div>
      </section>
  );
}

export default App;
