/**
 * Created by Samuel Gratzl on 19.07.2017.
 */
import {ARowRenderer} from './ARowRenderer';
import {IColumn, setColumn, StyleManager, TEMPLATE} from './style';
import {IExceptionContext, range} from './logic';
import {IMixinAdapter, IMixin, IMixinClass, EScrollResult} from './mixin';

const debug = false;

export interface ICellRenderContext<T extends IColumn> extends IExceptionContext {
  readonly column: IExceptionContext;
  readonly columns: T[];
  readonly htmlId: string;
}

function setTemplate(root: HTMLElement) {
  root.innerHTML = TEMPLATE;
  return root;
}

export abstract class ACellRenderer<T extends IColumn> extends ARowRenderer {
  /**
   * pool of cels per column
   * @type {Array}
   */
  private readonly cellPool: HTMLElement[][] = [];

  protected readonly visibleColumns = {
    first: 0,
    forcedFirst: 0,
    last: 0,
    forcedLast: 0
  };
  protected visibleFirstColumnPos = 0;

  private style: StyleManager;

  private readonly columnAdapter: IMixinAdapter;
  private readonly columnMixins: IMixin[];

  private readonly columnFragment: DocumentFragment;

  constructor(protected readonly root: HTMLElement, ...mixinClasses: IMixinClass[]) {
    super(<HTMLElement>setTemplate(root).querySelector('main > article'), ...mixinClasses);
    root.classList.add('lineup-engine');

    this.columnAdapter = this.createColumnAdapter();
    this.columnMixins = mixinClasses.map((mixinClass) => new mixinClass(this.columnAdapter));

    this.columnFragment = root.ownerDocument.createDocumentFragment();

  }

  protected get header() {
    return <HTMLElement>this.root.querySelector('header > article');
  }

  protected get headerScroller() {
    return <HTMLElement>this.root.querySelector('header');
  }

  protected addColumnMixin(mixinClass: IMixinClass, options?: any) {
    this.columnMixins.push(new mixinClass(this.columnAdapter, options));
  }

  private createColumnAdapter(): IMixinAdapter {
    const r: any = {
      visible: this.visibleColumns,
      addAtBeginning: this.addColumnAtStart.bind(this),
      addAtBottom: this.addColumnAtEnd.bind(this),
      removeFromBeginning: this.removeColumnFromStart.bind(this),
      removeFromBottom: this.removeColumnFromEnd.bind(this),
      updateOffset: this.updateColumnOffset.bind(this),
      scroller: this.headerScroller
    };
    Object.defineProperties(r, {
      visibleFirstRowPos: {
        get: () => this.visibleFirstColumnPos,
        enumerable: true
      },
      context: {
        get: () => this.context.column,
        enumerable: true
      }
    });
    return r;
  }

  protected init() {
    const context = this.context;

    this.style = new StyleManager(this.root, context.htmlId, context.defaultRowHeight);
    this.style.update(this.context.columns, context.column.defaultRowHeight);

    //create all header columns
    {
      const fragment = this.columnFragment;
      const document = fragment.ownerDocument;
      context.columns.forEach((col) => {
        fragment.appendChild(this.createHeader(document, col));
        //init pool
        this.cellPool.push([]);
      });
      this.header.appendChild(fragment);
    }


    const scroller = <HTMLElement>this.body.parentElement;

    //sync scrolling of header and body
    let oldLeft = scroller.scrollLeft;
    scroller.addEventListener('scroll', () => {
      const left = scroller.scrollLeft;
      if (oldLeft === left) {
        return;
      }
      const isGoingRight = left > oldLeft;
      oldLeft = left;
      this.onScrolledHorizontally(left, scroller.clientWidth, isGoingRight);
    });

    super.init();
  }

  protected onScrolledHorizontally(scrollLeft: number, clientWidth: number, isGoingRight: boolean) {
    const scrollResult = this.onScrolledHorizontallyImpl(scrollLeft, clientWidth);
    this.columnMixins.forEach((mixin) => mixin.onScrolled(isGoingRight, scrollResult));
    return scrollResult;
  }

  /**
   * the current render context, upon change `recreate` the whole table
   * @returns {ICellRenderContext}
   */
  protected abstract get context(): ICellRenderContext<T>;

  protected abstract createHeader(document: Document, column: T, ...extras: any[]): HTMLElement;

  protected abstract updateHeader(node: HTMLElement, column: T, ...extras: any[]): HTMLElement | void;

  protected abstract createCell(document: Document, index: number, column: T, ...extras: any[]): HTMLElement;

  protected abstract updateCell(node: HTMLElement, index: number, column: T, ...extras: any[]): HTMLElement | void;


  private removeColumnFromStart(from: number, to: number) {
    this.forEachRow((row: HTMLElement) => {
      this.removeCellFromStart(row, from, to);
    });
    if (debug) {
      this.verifyRows();
    }
  }

  private removeCellFromStart(row: HTMLElement, from: number, to: number) {
    for (let i = from; i <= to; ++i) {
      const node = <HTMLElement>row.firstElementChild;
      node.remove();
      this.recycleCell(node, i);
    }
    if (debug) {
      verifyRow(row, -1, this.context.columns);
    }
  }

  private removeColumnFromEnd(from: number, to: number) {
    this.forEachRow((row: HTMLElement) => {
      this.removeCellFromEnd(row, from, to);
    });
    if (debug) {
      this.verifyRows();
    }
  }

  private removeCellFromEnd(row: HTMLElement, from: number, to: number) {
    for (let i = to; i >= from; --i) {
      const node = <HTMLElement>row.lastElementChild;
      node.remove();
      this.recycleCell(node, i);
    }
    if (debug) {
      verifyRow(row, -1, this.context.columns);
    }
  }

  private removeAllColumns() {
    this.forEachRow((row: HTMLElement) => {
      this.removeAllCells(row);
    });
    if (debug) {
      this.verifyRows();
    }
  }

  private removeAllCells(row: HTMLElement, shift = this.visibleColumns.first) {
    const arr = <HTMLElement[]>Array.from(row.children);
    row.innerHTML = '';
    arr.forEach((item, i) => {
      this.recycleCell(item, i + shift);
    });
    if (debug) {
      verifyRow(row, -1, this.context.columns);
    }
  }

  private forEachRow(callback: (row: HTMLElement, rowIndex: number) => void) {
    const rows = Array.from(this.body.children);
    const fragment = this.columnFragment;
    this.body.innerHTML = '';
    rows.forEach((row: HTMLElement, index) => {
      if (!row.classList.contains('loading')) {
        //skip loading ones
        callback(row, index + this.visible.first);
      }
      fragment.appendChild(row);
    });
    this.body.appendChild(fragment);
  }

  private selectCell(row: number, column: number, columns: T[], ...extras: any[]): HTMLElement {
    const pool = this.cellPool[column];
    const columnObj = columns[column];
    if (pool.length > 0) {
      const item = pool.pop()!;
      const r = this.updateCell(item, row, columnObj, ...extras);
      if (r && r !== item) {
        setColumn(r, columnObj);
      }
      return r ? r : item;
    }
    const r = this.createCell(this.body.ownerDocument, row, columnObj, ...extras);
    setColumn(r, columnObj);
    return r;
  }

  private recycleCell(item: HTMLElement, column: number) {
    this.cellPool[column].push(item);
  }

  private addColumnAtStart(from: number, to: number) {
    const {columns} = this.context;
    this.forEachRow((row: HTMLElement, rowIndex: number) => {
      this.addCellAtStart(row, rowIndex, from, to, columns);
    });
    if (debug) {
      this.verifyRows();
    }
  }

  private addCellAtStart(row: HTMLElement, rowIndex: number, from: number, to: number, columns: T[], ...extras: any[]) {
    for (let i = to; i >= from; --i) {
      const cell = this.selectCell(rowIndex, i, columns, ...extras);
      row.insertBefore(cell, row.firstChild);
    }
    if (debug) {
      verifyRow(row, rowIndex, this.context.columns);
    }
  }

  private addColumnAtEnd(from: number, to: number) {
    const {columns} = this.context;
    this.forEachRow((row: HTMLElement, rowIndex: number) => {
      this.addCellAtEnd(row, rowIndex, from, to, columns);
    });
    if (debug) {
      this.verifyRows();
    }
  }

  private verifyRows() {
    const {columns} = this.context;
    this.forEachRow((row, rowIndex) => verifyRow(row, rowIndex, columns));
  }

  private addCellAtEnd(row: HTMLElement, rowIndex: number, from: number, to: number, columns: T[], ...extras: any[]) {
    for (let i = from; i <= to; ++i) {
      const cell = this.selectCell(rowIndex, i, columns, ...extras);
      row.appendChild(cell);
    }
    if (debug) {
      verifyRow(row, rowIndex, this.context.columns);
    }
  }

  protected recreate() {
    const context = this.context;

    const scroller = this.bodyScroller;
    const {first, last, firstRowPos} = range(scroller.scrollLeft, scroller.clientWidth, context.column.defaultRowHeight, context.column.exceptions, context.column.numberOfRows);

    this.visibleColumns.first = this.visibleColumns.forcedFirst = first;
    this.visibleColumns.last = this.visibleColumns.forcedLast = last;

    super.recreate();
    this.updateColumnOffset(firstRowPos);
  }

  protected clearPool() {
    super.clearPool();
    this.cellPool.forEach((p) => p.splice(0, p.length));
  }

  private updateColumnOffset(firstColumnPos: number) {
    this.visibleFirstColumnPos = firstColumnPos;
    // TODO
  }

  protected createRow(node: HTMLElement, rowIndex: number, ...extras: any[]): void {
    const {columns} = this.context;
    const visible = this.visibleColumns;

    for (let i = visible.first; i <= visible.last; ++i) {
      const cell = this.selectCell(rowIndex, i, columns, ...extras);
      node.appendChild(cell);
    }
  }

  protected updateRow(node: HTMLElement, rowIndex: number, ...extras: any[]): void {
    const {columns} = this.context;
    const visible = this.visibleColumns;

    //columns may not match anymore if it is a pooled item a long time ago
    const existing = <HTMLElement[]>Array.from(node.children);

    switch (existing.length) {
      case 0:
        this.addCellAtStart(node, rowIndex, visible.first, visible.last, columns, ...extras);
        break;
      case 1:
        const old = existing[0];
        const id = old.dataset.id!;
        const columnIndex = columns.findIndex((c) => c.id === id);
        node.removeChild(old);
        this.recycleCell(old, columnIndex);
        this.addCellAtStart(node, rowIndex, visible.first, visible.last, columns, ...extras);
        break;
      default: //>=2
        const firstId = existing[0].dataset.id!;
        const lastId = existing[existing.length - 1].dataset.id!;
        const firstIndex = columns.findIndex((c) => c.id === firstId);
        const lastIndex = columns.findIndex((c) => c.id === lastId);

        if (firstIndex === visible.first && lastIndex === visible.last) {
          //match update
          existing.forEach((child, i) => {
            const cell = this.updateCell(child, rowIndex, columns[i + visible.first], ...extras);
            if (cell && cell !== child) {
              setColumn(cell, columns[i + visible.first]);
              node.replaceChild(cell, child);
            }
          });
        } else if (visible.last > firstIndex || visible.first < lastIndex) {
          //no match at all
          this.removeAllCells(node, firstIndex);
          this.addCellAtStart(node, rowIndex, visible.first, visible.last, columns, ...extras);
        } else if (visible.first < firstIndex) {
          //some first rows missing and some last rows to much
          this.removeCellFromEnd(node, visible.last + 1, firstIndex);
          this.addCellAtStart(node, rowIndex, visible.first, firstIndex - 1, columns, ...extras);
        } else {
          //some last rows missing and some first rows to much
          this.removeCellFromStart(node, firstIndex, visible.first - 1);
          this.addCellAtEnd(node, rowIndex, lastIndex + 1, visible.last, columns, ...extras);
        }
    }
  }

  private onScrolledHorizontallyImpl(scrollLeft: number, clientWidth: number): EScrollResult {
    const column = this.context.column;
    const {first, last, firstRowPos} = range(scrollLeft, clientWidth, column.defaultRowHeight, column.exceptions, column.numberOfRows);

    const visible = this.visibleColumns;
    visible.forcedFirst = first;
    visible.forcedLast = last;

    if ((first - visible.first) >= 0 && (last - visible.last) <= 0) {
      //nothing to do
      return EScrollResult.NONE;
    }

    let r: EScrollResult = EScrollResult.PARTIAL;

    if (first > visible.last || last < visible.first) {
      //no overlap, clean and draw everything
      //console.log(`ff added: ${last - first + 1} removed: ${visibleLast - visibleFirst + 1} ${first}:${last} ${offset}`);
      //removeRows(visibleFirst, visibleLast);
      this.removeAllColumns();
      this.addColumnAtEnd(first, last);
      r = EScrollResult.ALL;
    } else if (first < visible.first) {
      //some first rows missing and some last rows to much
      //console.log(`up added: ${visibleFirst - first + 1} removed: ${visibleLast - last + 1} ${first}:${last} ${offset}`);
      this.removeColumnFromEnd(last + 1, visible.last);
      this.addColumnAtStart(first, visible.first - 1);
    } else {
      //console.log(`do added: ${last - visibleLast + 1} removed: ${first - visibleFirst + 1} ${first}:${last} ${offset}`);
      //some last rows missing and some first rows to much
      this.removeColumnFromStart(visible.first, first - 1);
      this.addColumnAtEnd(visible.last + 1, last);
    }

    visible.first = first;
    visible.last = last;

    this.updateColumnOffset(firstRowPos);

    return r;
  }

}

function verifyRow(row: HTMLElement, index: number, columns: IColumn[]) {
  const cols = <HTMLElement[]>Array.from(row.children);
  //sort incrementally
  if (cols.length <= 1) {
    return;
  }
  const colObjs = cols.map((c) => columns.find((d) => d.id === c.dataset.id)!);
  console.assert(colObjs.every((d) => Boolean(d)), 'all columns must exist', index);
  console.assert(colObjs.every((d, i) => i > 0 && d.index >= colObjs[i - 1]!.index), 'all columns in ascending order', index);
}

export default ACellRenderer;
