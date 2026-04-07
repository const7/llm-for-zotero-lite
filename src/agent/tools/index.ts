import { AgentToolRegistry } from "./registry";
import { PdfService } from "../services/pdfService";
import { RetrievalService } from "../services/retrievalService";
import { ZoteroGateway } from "../services/zoteroGateway";
import { createQueryLibraryTool } from "./read/queryLibrary";
import { createReadLibraryTool } from "./read/readLibrary";
import { createReadPaperTool } from "./read/readPaper";
import { createSearchPaperTool } from "./read/searchPaper";
import { createViewPdfPagesTool } from "./read/viewPdfPages";
import { createReadAttachmentTool } from "./read/readAttachment";
import { clearPdfToolCaches } from "./read/pdfToolUtils";
import { createSearchLiteratureOnlineTool } from "./read/searchLiteratureOnline";

import { createEditCurrentNoteTool } from "./write/editCurrentNote";
import { createUndoLastActionTool } from "./write/undoLastAction";
import { createApplyTagsTool } from "./write/applyTags";
import { createMoveToCollectionTool } from "./write/moveToCollection";
import { createUpdateMetadataTool } from "./write/updateMetadata";
import { createManageCollectionsTool } from "./write/manageCollections";
import { createImportIdentifiersTool } from "./write/importIdentifiers";
import { createTrashItemsTool } from "./write/trashItems";
import { createMergeItemsTool } from "./write/mergeItems";
import { createManageAttachmentsTool } from "./write/manageAttachments";
import { createRunCommandTool } from "./write/runCommand";
import { createImportLocalFilesTool } from "./write/importLocalFiles";
import { createFileIOTool } from "./write/fileIO";
import { createZoteroScriptTool } from "./write/zoteroScript";
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
  registry.register(createQueryLibraryTool(deps.zoteroGateway));
  registry.register(createReadLibraryTool(deps.zoteroGateway));
  registry.register(createReadPaperTool(deps.pdfService, deps.zoteroGateway));
  registry.register(
    createSearchPaperTool(
      deps.retrievalService,
      deps.pdfService,
      deps.zoteroGateway,
    ),
  );
  registry.register(
    createViewPdfPagesTool(deps.pdfPageService, deps.zoteroGateway),
  );
  registry.register(
    createReadAttachmentTool(deps.zoteroGateway, deps.pdfPageService),
  );
  registry.register(createSearchLiteratureOnlineTool(deps.zoteroGateway));
  registry.register(createApplyTagsTool(deps.zoteroGateway));
  registry.register(createMoveToCollectionTool(deps.zoteroGateway));
  registry.register(createUpdateMetadataTool(deps.zoteroGateway));
  registry.register(createManageCollectionsTool(deps.zoteroGateway));
  registry.register(createImportIdentifiersTool(deps.zoteroGateway));
  registry.register(createTrashItemsTool(deps.zoteroGateway));
  registry.register(createMergeItemsTool(deps.zoteroGateway));
  registry.register(createManageAttachmentsTool(deps.zoteroGateway));
  registry.register(createEditCurrentNoteTool(deps.zoteroGateway));
  registry.register(createRunCommandTool());
  registry.register(createImportLocalFilesTool(deps.zoteroGateway));
  registry.register(createFileIOTool());
  registry.register(createZoteroScriptTool());
  registry.register(createUndoLastActionTool());
  return registry;
}

export function clearAllAgentToolCaches(conversationKey: number): void {
  clearPdfToolCaches(conversationKey);
}
