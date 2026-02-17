import { OpenIssue } from "../types/stream";

interface IssueBacklogProps {
  issues: OpenIssue[];
}

export function IssueBacklog({ issues }: IssueBacklogProps) {
  return (
    <div className="card">
      <h2>Maintainer Backlog</h2>
      <p className="muted">Open these as GitHub issues after publishing the repository.</p>
      <div className="issue-list">
        {issues.map((issue) => (
          <article key={issue.id} className="issue-item">
            <h3>{issue.title}</h3>
            <p>{issue.summary}</p>
            <p className="muted">
              Complexity: {issue.complexity} | Points: {issue.points}
            </p>
            <div className="chip-row">
              {issue.labels.map((label) => (
                <span key={label} className="chip">
                  {label}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
