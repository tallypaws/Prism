import { Octokit } from "@octokit/rest";
import type { APIEmbed } from "discord.js";

type components = any;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO_OWNER = "tallypaws";
const GITHUB_REPO_NAME = "Prism";
const octokit = new Octokit({
  auth: GITHUB_TOKEN,
});

const fetchCommitData = async (url: string) => {
  const commitHash = url.split("/").pop() ?? "";
  try {
    const response = await octokit.repos.getCommit({
      owner: GITHUB_REPO_OWNER,
      repo: GITHUB_REPO_NAME,
      ref: commitHash,
    });
    return response.data;
  } catch (error) {
    console.error("Error fetching commit data:", error);
    return null;
  }
};

const fetchCommitsInRange = async (base: string, head: string) => {
  try {
    const response = await octokit.repos.compareCommits({
      owner: GITHUB_REPO_OWNER,
      repo: GITHUB_REPO_NAME,
      base,
      head,
    });
    return response.data.commits;
  } catch (error) {
    console.error("Error fetching commits in range:", error);
    return [];
  }
};

const createCommitEmbeds = (commitData: {
  url: string;
  sha: string;
  node_id: string;
  html_url: string;
  comments_url: string;
  commit: {
    url: string;
    author: components["schemas"]["nullable-git-user"];
    committer: components["schemas"]["nullable-git-user"];
    message: string;
    comment_count: number;
    tree: {
      sha: string;
      url: string;
    };
    verification?: components["schemas"]["verification"];
  };
  author: components["schemas"]["nullable-simple-user"];
  committer: components["schemas"]["nullable-simple-user"];
  parents: {
    sha: string;
    url: string;
    html_url?: string;
  }[];
  stats?: {
    additions?: number;
    deletions?: number;
    total?: number;
  };
  files?: components["schemas"]["diff-entry"][];
}) => {
  const { commit, stats, files, html_url } = commitData;
  if (
    !(
      commit.author &&
      commit.author.date &&
      commit.author.name &&
      stats &&
      files
    )
  )
    return;
  let embeds: APIEmbed[] = [
    {
      color: 0x0099ff,
      title: `Commit: ${commit.message.split("\n")[0]}`,
      description: commit.message,
      url: html_url,
      fields: [
        { name: "Author", value: commit.author.name, inline: true },

        {
          name: "Total Files Changed",
          value: `${files.length} files`,
          inline: true,
        },
        {
          name: "Lines Added",
          value: `${stats.additions}`,
          inline: true,
        },
        {
          name: "Lines Removed",
          value: `${stats.deletions}`,
          inline: true,
        },
      ],
      timestamp: new Date(commit.author.date).toISOString(),
    },
  ];

  const fileChunks = [];
  for (let i = 0; i < files.length; i += 25) {
    fileChunks.push(files.slice(i, i + 25));
  }

  fileChunks.forEach((chunk, index) => {
    let fileEmbed: any = {
      color: 0x0099ff,
      title:
        index === 0
          ? "Files Changed"
          : `Files Changed (Continued ${index + 1})`,
      fields: [],
    };

    chunk.forEach((file: { filename: any; additions: any; deletions: any }) => {
      fileEmbed.fields.push({
        name: `File: ${file.filename}`,
        value: `+${file.additions} / -${file.deletions}`,
        inline: false,
      });
    });

    embeds.push(fileEmbed);
  });

  return embeds;
};

export const getCommitEmbedsFromURL = async (url: string) => {
  const commitHash = url.split("/").pop() ?? "";
  const baseHash = "";

  if (!baseHash) {
    const commitData = await fetchCommitData(url);
    if (!commitData) return null;

    const embeds = createCommitEmbeds(commitData);
    return embeds;
  }

  const commits = await fetchCommitsInRange(baseHash, commitHash);
  if (!commits.length) return null;

  const allEmbeds = [];
  for (const commit of commits) {
    const commitData = await fetchCommitData(commit.html_url);
    if (commitData) {
      const embeds = createCommitEmbeds(commitData);
      if (embeds) allEmbeds.push(...embeds);
    }
  }

  return allEmbeds;
};
