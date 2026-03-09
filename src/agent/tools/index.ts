import { AgentToolRegistry } from "./registry";
import { PdfService } from "../services/pdfService";
import { RetrievalService } from "../services/retrievalService";
import { ZoteroGateway } from "../services/zoteroGateway";
import { createGetActiveContextTool } from "./read/getActiveContext";
import { createListPaperContextsTool } from "./read/listPaperContexts";
import { createRetrievePaperEvidenceTool } from "./read/retrievePaperEvidence";
import { createReadPaperExcerptTool } from "./read/readPaperExcerpt";
import { createSearchLibraryItemsTool } from "./read/searchLibraryItems";
import { createReadAttachmentTextTool } from "./read/readAttachmentText";
import { createReadPaperFrontMatterTool } from "./read/readPaperFrontMatter";
import { createAuditArticleMetadataTool } from "./read/auditArticleMetadata";
import { createSearchPdfPagesTool } from "./read/searchPdfPages";
import { createPreparePdfPagesForModelTool } from "./read/preparePdfPagesForModel";
import { createPreparePdfFileForModelTool } from "./read/preparePdfFileForModel";
import { createSaveAnswerToNoteTool } from "./write/saveAnswerToNote";
import { createEditArticleMetadataTool } from "./write/editArticleMetadata";
import { PdfPageService } from "../services/pdfPageService";

type BuiltInAgentToolDeps = {
  zoteroGateway: ZoteroGateway;
  pdfService: PdfService;
  pdfPageService: PdfPageService;
  retrievalService: RetrievalService;
};

export function createBuiltInToolRegistry(
  deps: BuiltInAgentToolDeps,
): AgentToolRegistry {
  const registry = new AgentToolRegistry();
  registry.register(createGetActiveContextTool(deps.zoteroGateway));
  registry.register(createListPaperContextsTool(deps.zoteroGateway));
  registry.register(
    createRetrievePaperEvidenceTool(
      deps.zoteroGateway,
      deps.retrievalService,
    ),
  );
  registry.register(createReadPaperExcerptTool(deps.pdfService));
  registry.register(
    createReadPaperFrontMatterTool(deps.pdfService, deps.zoteroGateway),
  );
  registry.register(createSearchLibraryItemsTool(deps.zoteroGateway));
  registry.register(
    createAuditArticleMetadataTool(deps.zoteroGateway, deps.pdfService),
  );
  registry.register(createSearchPdfPagesTool(deps.pdfPageService));
  registry.register(createPreparePdfPagesForModelTool(deps.pdfPageService));
  registry.register(createPreparePdfFileForModelTool(deps.pdfPageService));
  registry.register(createReadAttachmentTextTool());
  registry.register(createSaveAnswerToNoteTool(deps.zoteroGateway));
  registry.register(createEditArticleMetadataTool(deps.zoteroGateway));
  return registry;
}
