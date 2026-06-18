import { MASSIVE_DOCS_BASE, MASSIVE_REST_BASE } from "@/lib/polygon-docs-nav";
import type { RestEndpointSection } from "@/lib/polygon-docs-rest-types";

type Props = {
  sections: RestEndpointSection[];
};

export function PolygonRestEndpointTable({ sections }: Props) {
  return (
    <>
      {sections.map((section) => (
        <section key={section.id} id={section.id} className="docs-section">
          <h2>{section.title}</h2>
          <div className="docs-rest-table-wrap">
            <table className="docs-table docs-rest-table">
              <thead>
                <tr>
                  <th>Endpoint</th>
                  <th>Path</th>
                  <th>Description</th>
                  <th>Use cases</th>
                </tr>
              </thead>
              <tbody>
                {section.endpoints.map((ep) => (
                  <tr key={ep.path}>
                    <td className="docs-rest-name">
                      <span className="docs-rest-method">{ep.method}</span>
                      <span>
                        {ep.name}
                        {ep.deprecated && (
                          <span className="docs-badge docs-badge-warn docs-rest-dep">Deprecated</span>
                        )}
                      </span>
                      <span className="docs-badge docs-badge-ok">Your plan</span>
                    </td>
                    <td>
                      <code className="docs-rest-path">
                        {MASSIVE_REST_BASE}
                        {ep.path}
                      </code>
                      {ep.docPath && (
                        <a
                          href={`${MASSIVE_DOCS_BASE}${ep.docPath}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="docs-rest-doc-link"
                        >
                          Official doc ↗
                        </a>
                      )}
                    </td>
                    <td>{ep.description}</td>
                    <td className="docs-rest-usecases">{ep.useCases}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}
