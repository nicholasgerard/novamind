import { describe, expect, it } from "vitest";
import { parsePubMedXml } from "./pubmed";

describe("parsePubMedXml", () => {
  it("parses representative PubMed XML with labels, entities, authors, and MeSH", () => {
    const papers = parsePubMedXml(`<?xml version="1.0"?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID Version="1">12345</PMID>
      <Article>
        <Journal>
          <JournalIssue>
            <PubDate><Year>2024</Year></PubDate>
          </JournalIssue>
          <Title>New England Journal of Medicine</Title>
        </Journal>
        <ArticleTitle>Semaglutide &amp; cardiometabolic outcomes</ArticleTitle>
        <Abstract>
          <AbstractText Label="BACKGROUND">GLP-1 receptor agonists are used for diabetes.</AbstractText>
          <AbstractText Label="RESULTS">HbA1c improved by 1.2 percentage points.</AbstractText>
        </Abstract>
        <AuthorList>
          <Author><LastName>Smith</LastName><Initials>JA</Initials></Author>
          <Author><CollectiveName>Trial Investigators</CollectiveName></Author>
        </AuthorList>
      </Article>
      <MeshHeadingList>
        <MeshHeading><DescriptorName MajorTopicYN="Y">Glucagon-Like Peptide-1 Receptor</DescriptorName></MeshHeading>
      </MeshHeadingList>
    </MedlineCitation>
  </PubmedArticle>
</PubmedArticleSet>`);

    expect(papers).toEqual([
      {
        pmid: "12345",
        title: "Semaglutide & cardiometabolic outcomes",
        abstract:
          "BACKGROUND: GLP-1 receptor agonists are used for diabetes.\nRESULTS: HbA1c improved by 1.2 percentage points.",
        year: 2024,
        journal: "New England Journal of Medicine",
        authors: ["Smith JA", "Trial Investigators"],
        meshTerms: ["Glucagon-Like Peptide-1 Receptor"],
      },
    ]);
  });
});
