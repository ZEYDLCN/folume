import type {
  Asset,
  Block,
  Document,
  DocumentQuality,
  Metadata,
  PageInfo,
  QualityFlag,
  Section,
  SourceRegion,
  Span,
} from './types.generated';

export type {
  Asset,
  Block,
  Document,
  DocumentQuality,
  Metadata,
  PageInfo,
  QualityFlag,
  Section,
  SourceRegion,
  Span,
};
export type { OmittedRegion, PageQuality, QualityIssue, TableData, TextLedger } from './types.generated';

export type BlockType = Block['type'];
export type FlagCode = QualityFlag['code'];
export type Severity = QualityFlag['severity'];
