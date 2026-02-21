export interface OpenIssue {
  id: string;
  title: string;
  labels: string[];
  summary: string;
  complexity: "Trivial" | "Medium" | "High";
  points: 100 | 150 | 200;
}

export async function fetchOpenIssues(): Promise<OpenIssue[]> {
  try {
    const response = await fetch("https://api.github.com/repos/ritik4ever/stellar-stream/issues?state=open", {
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "StellarStream-Backend"
      }
    });

    if (!response.ok) {
      console.error(`Failed to fetch issues: ${response.status} ${response.statusText}`);
      return [];
    }

    const issues = (await response.json()) as any[];

    return issues.map((issue) => {
      // Basic complexity mapping based on labels, default to "Medium"
      let complexity: OpenIssue["complexity"] = "Medium";
      let points: OpenIssue["points"] = 150;

      const labels = issue.labels.map((l: any) => l.name?.toLowerCase() || "");

      if (labels.includes("good first issue") || labels.includes("trivial")) {
        complexity = "Trivial";
        points = 100;
      } else if (labels.includes("complex") || labels.includes("hard")) {
        complexity = "High";
        points = 200;
      }

      return {
        id: issue.number.toString(),
        title: issue.title,
        labels: issue.labels.map((l: any) => l.name),
        summary: issue.body ? issue.body.slice(0, 150) + "..." : "No description provided.",
        complexity,
        points,
      };
    });
  } catch (error) {
    console.error("Error fetching GitHub issues:", error);
    return []; // Return empty array on failure so frontend doesn't crash completely
  }
}
