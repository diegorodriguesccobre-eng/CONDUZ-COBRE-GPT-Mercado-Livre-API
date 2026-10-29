import { createBoundPorts, type HomologationBindings } from './ports';
import { createHomologationHandler } from './composition';

// This is the only public export. No DO fixture class, seed, fault or administrative method is exported.
export default {
  fetch(request: Request, env: HomologationBindings): Promise<Response> | Response {
    try { return createHomologationHandler(createBoundPorts(env))(request); }
    catch {
      return Response.json({ error: 'INTEGRATION_DEPENDENCY_UNAVAILABLE' }, {
        status: 503, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
      });
    }
  }
};
