import { RichTextItemResponse } from '@notionhq/client/build/src/api-endpoints';
import {
  ProcessorChainNode,
  ChainData,
  BlockType,
  ListBlockChildrenResponseResult,
  ListBlockChildrenResponseResults,
  PageProperties,
  AnnotationTransformer,
  BlockTransformer,
  ContextMetadata,
  VariableResolver,
  RendererContext,
  VariableCollector,
  VariableResolvers,
} from '../../types';

/**
 * Interface for renderer plugins in the Notion-to-MD system.
 * Provides core framework for transforming Notion blocks into any desired output format.
 */
export abstract class BaseRendererPlugin implements ProcessorChainNode {
  next?: ProcessorChainNode;

  /**
   * Defines the document structure using variables in {{{variableName}}} format.
   * Must include at least 'content' and 'imports' variables.
   */
  protected template: string = `{{{imports}}}\n{{{content}}}`;

  // Internal state
  private variableDataCollector: VariableCollector = new Map();
  private variableResolvers: VariableResolvers = new Map();

  // Protected context available to child classes
  protected context: RendererContext;

  constructor() {
    // Initialize context with default values
    this.context = {
      pageId: '',
      pageProperties: {},
      metadata: {},
      block: {} as ListBlockChildrenResponseResult,
      blockTree: [],
      variableData: this.variableDataCollector,
      transformers: {
        blocks: {} as Record<BlockType, BlockTransformer>,
        annotations: {} as Record<string, AnnotationTransformer>,
      },
      utils: {
        processRichText: this.processRichText.bind(this),
        processChildren: this.processChildren.bind(this),
      },
    };
    console.debug('[BaseRendererPlugin] Context initialized');

    // Initialize required variables
    this.initializeDefaultVariables();

    // Initialize additional variables from template
    this.validateAndInitializeTemplate();
    console.debug(
      '[BaseRendererPlugin] Renderer plugin initialization complete',
    );
  }

  private validateAndInitializeTemplate(): void {
    console.debug('[BaseRendererPlugin] Validating and initializing template');

    // First validate the template exists
    if (!this.template) {
      console.debug('[BaseRendererPlugin] Template not defined');
      throw new Error('Template must be defined');
    }

    // Reuse existing validation method
    this.validateTemplate(this.template);

    // Initialize default variables first - these are required
    this.initializeDefaultVariables();

    // Then initialize template-specific variables
    this.initializeTemplateVariables();
    console.debug('[BaseRendererPlugin] Template initialization complete');
  }

  /**
   * Adds custom metadata that will be available throughout rendering
   */
  public addMetadata(key: string, value: any): this {
    this.context.metadata[key] = value;
    return this;
  }

  /**
   * Adds a new variable with an optional custom resolver
   */
  public addVariable(name: string, resolver?: VariableResolver): this {
    console.debug(`[BaseRendererPlugin] Adding variable: ${name}`);

    // Create collector if it doesn't exist
    if (!this.variableDataCollector.has(name)) {
      this.variableDataCollector.set(name, []);
      console.debug(`[BaseRendererPlugin] Created new collector for: ${name}`);
    }

    // Register resolver if provided
    if (resolver) {
      this.variableResolvers.set(name, resolver);
      console.debug(
        `[BaseRendererPlugin] Registered custom resolver for: ${name}`,
      );
    }

    return this;
  }

  /**
   * Adds imports that will be collected in the imports variable
   */
  public addImports(...imports: string[]): this {
    const importCollector = this.variableDataCollector.get('imports') || [];
    imports.forEach((imp) => {
      if (!importCollector.includes(imp)) {
        importCollector.push(imp);
      }
    });
    this.variableDataCollector.set('imports', importCollector);
    return this;
  }

  /**
   * Updates template while ensuring required variables exist
   */
  public setTemplate(template: string): this {
    this.validateTemplate(template);
    this.template = template;
    this.initializeTemplateVariables();
    return this;
  }

  /**
   * Creates a single block transformer with proper type inference.
   * Note: Block level imports are stored with the transformer, not added to import variable immediately.
   * Only added when the transformer is actually used.
   */
  public createBlockTransformer<T extends BlockType>(
    type: T,
    transformer: BlockTransformer,
  ): this {
    this.context.transformers.blocks[type] = transformer;
    return this;
  }

  /**
   * Creates multiple block transformers at once
   */
  public createBlockTransformers(
    transformers: Partial<Record<BlockType, BlockTransformer>>,
  ): this {
    for (const [type, transformer] of Object.entries(transformers)) {
      if (transformer) {
        this.createBlockTransformer(type as BlockType, transformer);
      }
    }
    return this;
  }

  /**
   * Creates a single annotation transformer with proper type inference.
   */
  public createAnnotationTransformer(
    name: string,
    transformer: AnnotationTransformer,
  ): this {
    this.context.transformers.annotations[name] = transformer;
    return this;
  }

  /**
   * Creates multiple annotation transformers simultaneously.
   */
  public createAnnotationTransformers(
    transformers: Record<string, AnnotationTransformer>,
  ): this {
    Object.entries(transformers).forEach(([name, transformer]) => {
      this.createAnnotationTransformer(name, transformer);
    });
    return this;
  }

  /**
   * Main processing method that orchestrates the rendering pipeline
   */
  public async process(data: ChainData): Promise<ChainData> {
    console.debug('[BaseRendererPlugin] Starting rendering process', {
      pageId: data.pageId,
      blockCount: data.blockTree.blocks.length,
    });

    try {
      this.updateContext(data);
      this.resetCollectors();

      // Process all blocks
      console.debug('[BaseRendererPlugin] Processing blocks');
      for (const block of data.blockTree.blocks) {
        await this.processBlock(block);
      }

      const content = await this.renderTemplate();
      console.debug(
        '[BaseRendererPlugin] Rendering process completed successfully',
      );

      data = {
        ...data,
        content,
      };

      return this.next ? this.next.process(data) : data;
    } catch (error) {
      console.debug('[BaseRendererPlugin] Error during rendering:', error);
      throw new Error(
        `Renderer failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Core processing function that processes Notion rich text content.
   * Applies registered annotation transformers in order.
   */
  protected async processRichText(
    richText: RichTextItemResponse[],
    metadata?: ContextMetadata,
  ): Promise<string> {
    const results = await Promise.all(
      richText.map(async (item) => {
        let text = item.plain_text;
        let link = item.href;
        // Process each annotation that has a registered transformer
        for (const [name, value] of Object.entries(item.annotations)) {
          if (value && this.context.transformers.annotations[name]) {
            text = await this.context.transformers.annotations[name].transform({
              text,
              annotations: item.annotations,
              metadata,
            });
          }
        }

        // Apply link transformation last if exists
        if (item.href) {
          text = await this.context.transformers.annotations.link.transform({
            text,
            link: link ? { url: link } : undefined,
          });
        }

        return text;
      }),
    );

    return results.join('');
  }

  /**
   * Processes a block's child blocks recursively.
   */
  protected async processChildren(
    blocks: ListBlockChildrenResponseResults,
    metadata?: ContextMetadata,
  ): Promise<string> {
    const results = await Promise.all(
      blocks.map((block) => this.processBlock(block, metadata)),
    );

    return results.filter(Boolean).join('\n');
  }

  /**
   * Processes an individual block using registered transformers.
   * Handles import collection and variable targeting.
   */
  protected async processBlock(
    block: ListBlockChildrenResponseResult,
    metadata?: ContextMetadata,
  ): Promise<string> {
    // @ts-ignore
    const blockType = block.type;
    console.debug(
      `[BaseRendererPlugin] Processing block of type: ${blockType}`,
    );

    const transformer = this.context.transformers.blocks[blockType];
    if (!transformer) {
      console.debug(
        `[BaseRendererPlugin] No transformer found for type: ${blockType}`,
      );
      return '';
    }

    try {
      // Create context for this block transformation
      const blockContext: RendererContext = {
        ...this.context,
        block,
        metadata: {
          ...this.context.metadata,
          ...metadata,
        },
      };

      // Process the block
      const output = await transformer.transform(blockContext);
      console.debug(
        `[BaseRendererPlugin] Successfully transformed block: ${blockType}`,
      );

      // Handle imports
      if (transformer.imports?.length) {
        console.debug(`[BaseRendererPlugin] Adding imports for ${blockType}`);
        this.addImports(...transformer.imports);
      }

      // Handle variable targeting
      const targetVariable = transformer.targetVariable || 'content';
      if (!this.variableDataCollector.has(targetVariable)) {
        console.debug(
          `[BaseRendererPlugin] Creating new collector for target: ${targetVariable}`,
        );
        this.addVariable(targetVariable);
      }

      this.addToCollector(targetVariable, output);
      return output;
    } catch (error) {
      console.debug(
        `[BaseRendererPlugin] Error processing block ${blockType}:`,
        error,
      );
      throw new Error(
        `Failed to process block: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Initializes the required 'content' and 'imports' variables.
   * Sets up default resolver for 'imports' variable.
   */
  private initializeDefaultVariables(): void {
    console.debug('[BaseRendererPlugin] Initializing default variables');
    this.addVariable('imports', this.defaultResolver);
    this.addVariable('content', this.defaultResolver);
    console.debug('[BaseRendererPlugin] Default variables initialized');
  }

  /**
   * Default resolver for variables without custom resolvers.
   * Joins collected content with newlines.
   */
  private defaultResolver: VariableResolver = async (variableName, context) => {
    const collected = context.variableData.get(variableName) || [];
    return collected.join('\n');
  };

  private initializeTemplateVariables(): void {
    const variables = this.template.match(/{{{(\w+)}}}/g) || [];
    variables.forEach((variable) => {
      const name = variable.replace(/{{{|}}}/, '');
      this.addVariable(name);
    });
  }

  private validateTemplate(template: string): void {
    const required = ['content', 'imports'];
    required.forEach((name) => {
      if (!template.includes(`{{{${name}}}}`)) {
        throw new Error(`Template must contain ${name} variable`);
      }
    });
  }

  /**
   * Adds content to a variable's collector, creating it if needed.
   */
  private addToCollector(variable: string, content: string): void {
    // Ensure the collector exists
    if (!this.variableDataCollector.has(variable)) {
      this.variableDataCollector.set(variable, []);
    }

    // Add content to collector
    const collector = this.variableDataCollector.get(variable)!;
    collector.push(content);
  }

  /**
   * Resolves variables using their registered resolvers or default resolver.
   * Replaces {{{variableName}}} in template with resolved content.
   */
  private async renderTemplate(): Promise<string> {
    console.debug('[BaseRendererPlugin] Starting template rendering');
    const resolvedVariables: Record<string, string> = {};

    for (const [name, collector] of this.variableDataCollector.entries()) {
      console.debug(`[BaseRendererPlugin] Resolving variable: ${name}`);
      const resolver = this.variableResolvers.get(name) || this.defaultResolver;
      resolvedVariables[name] = await resolver(name, {
        ...this.context,
      });
    }

    console.debug(
      '[BaseRendererPlugin] Template variables resolved, applying to template',
    );
    return this.template.replace(
      /{{{(\w+)}}}/g,
      (_, name) => resolvedVariables[name] || '',
    );
  }

  /**
   * Resets all variable collectors while preserving imports.
   * Called at the start of each processing cycle.
   */
  private resetCollectors(): void {
    // Preserve imports when resetting collectors
    const imports = this.variableDataCollector.get('imports') || [];

    // Reset all collectors
    for (const [name] of this.variableDataCollector) {
      this.variableDataCollector.set(name, name === 'imports' ? imports : []);
    }
  }

  private updateContext(data: ChainData): void {
    this.context = {
      ...this.context,
      pageId: data.pageId,
      pageProperties: data.blockTree.properties,
      blockTree: data.blockTree.blocks,
      metadata: {
        ...this.context.metadata,
        ...data.metadata,
      },
    };
  }
}
