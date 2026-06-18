import type { UwEndpointSection } from "@/lib/uw-docs-catalog";
import { UW_DOCS_BASE } from "@/lib/uw-docs-catalog";

type Props = {
  sections: UwEndpointSection[];
};

export function UwEndpointTable({ sections }: Props) {
  return (
    <>
      {sections.map((section) => (
        <section key={section.id} id={section.id} className="docs-section">
          <h2>{section.title}</h2>
          <p className="docs-note">{section.endpoints.length} endpoints</p>
          <div className="docs-rest-table-wrap">
            <table className="docs-table docs-rest-table">
              <thead>
                <tr>
                  <th>Endpoint</th>
                  <th>Path</th>
                  <th>Operation ID</th>
                </tr>
              </thead>
              <tbody>
                {section.endpoints.map((ep) => (
                  <tr key={ep.path + ep.operationId}>
                    <td className="docs-rest-name">
                      <span className="docs-rest-method">{ep.method}</span>
                      <span>
                        {ep.name}
                        {ep.deprecated && (
                          <span className="docs-badge docs-badge-warn docs-rest-dep">Deprecated</span>
                        )}
                      </span>
                      {ep.blackout && (
                        <span className="docs-badge docs-badge-uw">BlackOut</span>
                      )}
                    </td>
                    <td>
                      <code className="docs-rest-path">
                        {UW_DOCS_BASE}
                        {ep.path}
                      </code>
                      <a
                        href={ep.docUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="docs-rest-doc-link"
                      >
                        Official doc ↗
                      </a>
                    </td>
                    <td>
                      <code className="docs-rest-op">{ep.operationId}</code>
                    </td>
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
