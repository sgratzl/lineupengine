import {IExceptionContext, range} from '../logic';
import {clear} from '../internal/index';
import QuadTreeNode, {
  BOTTOM_LEFT, BOTTOM_RIGHT, QuadTreeInnerNode, QuadTreeLeafNode, TOP_LEFT,
  TOP_RIGHT
} from './internal/QuadTreeNode';

const template = `<header></header>
<aside></aside>
<main><div></div></main><style></style>`;


export interface ICellContext {
  row: IExceptionContext;
  col: IExceptionContext;
}

const leafCount = 4; //don't split further than 4x4 grids

export abstract class ACellRenderer {
  private readonly poolLeaves: HTMLElement[] = [];
  private readonly poolInner: HTMLElement[] = [];
  //private readonly fragment: DocumentFragment;

  /** @internal */
  private tree: QuadTreeNode | null = null;

  constructor(private readonly root: HTMLElement) {
    root.innerHTML = template;
    root.classList.add('lineup-cell-engine');
    // this.fragment = root.ownerDocument!.createDocumentFragment();
  }

  protected abstract get context(): ICellContext;

  private get doc() {
    return this.root.ownerDocument!;
  }

  private get body(): HTMLElement {
    return <HTMLElement>this.root.children[2]!;
  }

  private get colHeader(): HTMLElement {
    return <HTMLElement>this.root.firstElementChild!;
  }

  private get rowHeader(): HTMLElement {
    return <HTMLElement>this.root.children[1]!;
  }

  protected abstract createCell(doc: Document, row: number, col: number): HTMLElement;

  protected abstract updateCell(node: HTMLElement, row: number, col: number): HTMLElement | void;

  protected abstract createRowHeader(doc: Document, row: number): HTMLElement;

  protected abstract updateRowHeader(node: HTMLElement, row: number): HTMLElement | void;

  protected abstract createColumnHeader(doc: Document, col: number): HTMLElement;

  protected abstract updateColumnHeader(node: HTMLElement, col: number): HTMLElement | void;

  protected init() {
    const body = this.body;
    const rowHeader = this.rowHeader;
    const colHeader = this.colHeader;

    let oldTop = body.scrollTop;
    let oldLeft = body.scrollLeft;
    body.addEventListener('scroll', () => {
      const left = body.scrollLeft;
      const top = body.scrollTop;
      if (oldTop === top && oldLeft === left) {
        return;
      }
      const isGoingDown = top > oldTop;
      const isGoingRight = left > oldLeft;

      oldTop = top;
      oldLeft = left;

      rowHeader.scrollTop = top;
      colHeader.scrollLeft = left;

      this.onScroll(left, top, body.clientWidth, body.clientHeight, isGoingDown, isGoingRight);
    });

    this.recreate();
  }

  private static sliceHeight(ctx: IExceptionContext, start: number, end: number) {
    let height = (end - start + 1) * ctx.defaultRowHeight;
    for (const ex of ctx.exceptions) {
      if (ex.index < start) {
        continue;
      }
      if (ex.index > end) {
        break;
      }
      height += ex.height - ctx.defaultRowHeight; //change to exception height
    }
    return height;
  }

  private buildTree(row: IExceptionContext, col: IExceptionContext) {
    const build = (index: number, rowFirst: number, rowLast: number, colFirst: number, colLast: number, rowTotal: number, colTotal: number) => {
      const rowCount = rowLast - rowFirst + 1;
      const colCount = colLast - colFirst + 1;
      if (rowCount <= leafCount && colCount <= leafCount) {
        return new QuadTreeLeafNode(index, rowFirst, rowLast, colFirst, colLast, rowTotal, colTotal);
      }
      const inner = new QuadTreeInnerNode(index, rowFirst, rowLast, colFirst, colLast, rowTotal, colTotal);

      const leftSlice = ACellRenderer.sliceHeight(col, colFirst, inner.colMiddle);
      const rightSlice = colTotal - leftSlice;

      const topSlice = ACellRenderer.sliceHeight(row, rowFirst, inner.rowMiddle);
      const bottomSlice = rowTotal - topSlice;

      inner.children.push(build(TOP_LEFT, rowFirst, inner.rowMiddle, colFirst, inner.colMiddle, topSlice, leftSlice));
      inner.children.push(build(TOP_RIGHT, rowFirst, inner.rowMiddle, inner.colMiddle + 1, colLast, topSlice, rightSlice));
      inner.children.push(build(BOTTOM_LEFT, inner.rowMiddle + 1, rowLast, colFirst, inner.colMiddle, bottomSlice, leftSlice));
      inner.children.push(build(BOTTOM_RIGHT, inner.rowMiddle + 1, rowLast, inner.colMiddle + 1, colLast, bottomSlice, rightSlice));

      inner.children.forEach((c) => c.parent = inner);
      return inner;
    };

    return build(0, 0, row.numberOfRows - 1, 0, col.numberOfRows - 1, row.totalHeight, col.totalHeight);
  }

  protected recreate() {
    const context = this.context;
    const body = this.body;
    this.tree = this.buildTree(context.row, context.col);

    //clear
    const root = <HTMLElement>body.firstElementChild!;
    Array.from(root.children).forEach((c) => this.recycle(<HTMLElement>c));
    this.clearPool();

    const col = range(body.scrollLeft, body.clientWidth, context.col.defaultRowHeight, context.col.exceptions, context.col.numberOfRows);
    const row = range(body.scrollTop, body.clientHeight, context.row.defaultRowHeight, context.row.exceptions, context.row.numberOfRows);

    root.dataset.node = this.tree.type;
    root.dataset.id = this.tree.id;
    root.style.width = `${this.tree.width}px`;
    root.style.height = `${this.tree.height}px`;
    this.render(this.tree, root, row.first, row.last, col.first, col.last);
  }

  private onScroll(left: number, top: number, width: number, height: number, _isGoingDown: boolean, _isGoingRight: boolean) {
    const context = this.context;

    const col = range(left, width, context.col.defaultRowHeight, context.col.exceptions, context.col.numberOfRows);
    const row = range(top, height, context.row.defaultRowHeight, context.row.exceptions, context.row.numberOfRows);

    const root = <HTMLElement>this.body.firstElementChild!;
    this.render(this.tree!, root, row.first, row.last, col.first, col.last);
  }

  private renderLeaf(leaf: QuadTreeLeafNode, parent: HTMLElement) {
    const doc = this.doc;
    const children = <HTMLElement[]>Array.from(parent.children);
    parent.dataset.leafCols = String(leaf.colCount);
    if (children.length > 0) {
      clear(parent);
    }
    for (let row = leaf.rowFirst; row <= leaf.rowLast; ++row) {
      for (let col = leaf.colFirst; col <= leaf.colLast; ++col) {
        let item: HTMLElement;
        if (children.length > 0) {
          item = children.shift()!;
          const change = this.updateCell(item, row, col);
          if (change && change !== item) {
            children.unshift(item);
            item = change;
          }
        } else {
          item = this.createCell(doc, row, col);
        }
        item.dataset.row = String(row);
        item.dataset.col = String(col);
        parent.appendChild(item);
      }
      parent.appendChild(doc.createElement('br'));
    }
    return parent;
  }

  private render(node: QuadTreeNode, parent: HTMLElement, rowFirst: number, rowLast: number, colFirst: number, colLast: number) {
    if (node.type === 'leaf') {
      return this.renderLeaf(<QuadTreeLeafNode>node, parent);
    }
    const inner = <QuadTreeInnerNode>node;

    const create = (index: number) => {
      const child = inner.children[index];
      let node: HTMLElement;
      if (child.type === 'inner') {
        node = this.poolInner.length > 0 ? this.poolInner.pop()! : this.doc.createElement('div');
      } else {
        node = this.poolLeaves.length > 0 ? this.poolLeaves.pop()! : this.doc.createElement('div');
      }
      node.dataset.node = child.type;
      node.dataset.id = child.id;
      return this.render(child, node, rowFirst, rowLast, colFirst, colLast);
    };

    const placeholder = (index: number) => {
      const child = inner.children[index];
      const node = this.poolInner.length > 0 ? this.poolInner.pop()! : this.doc.createElement('div');
      node.dataset.node = 'placeholder';
      node.dataset.id = child.id;
      node.style.width = `${child.width}px`;
      node.style.height = `${child.height}px`;
      return node;
    };

    const children = <HTMLElement[]>Array.from(parent.children);

    const showLeft = !(inner.colFirst > colLast || inner.colMiddle < colFirst);
    const showRight = !(inner.colMiddle > colLast || inner.colLast < colFirst);
    const showTop = !(inner.rowFirst > rowLast || inner.rowMiddle < rowFirst);
    const showBottom = !(inner.rowMiddle > rowLast || inner.rowLast < rowFirst);

    if (children.length === 0) {
      parent.appendChild(showLeft && showTop ? create(TOP_LEFT) : placeholder(TOP_LEFT));
      parent.appendChild(showRight && showTop ? create(TOP_RIGHT) : placeholder(TOP_RIGHT));
      parent.appendChild(this.doc.createElement('br'));
      parent.appendChild(showLeft && showBottom ? create(BOTTOM_LEFT) : placeholder(BOTTOM_LEFT));
      parent.appendChild(showRight && showBottom ? create(BOTTOM_RIGHT) : placeholder(BOTTOM_RIGHT));
      return parent;
    }

    //can reuse
    {
      const node = children[TOP_LEFT];
      const down = showLeft && showTop;
      if (down !== (node.dataset.node !== 'placeholder')) {
        // no match
        parent.replaceChild(down ? create(TOP_LEFT) : placeholder(TOP_LEFT), node);
        this.recycle(node);
      } else if (down && inner.children[TOP_LEFT].type === 'inner') {
        this.render(inner.children[TOP_LEFT], node, rowFirst, rowLast, colFirst, colLast);
      }
    }
    {
      const node = children[TOP_RIGHT];
      const down = showRight && showTop;
      if (down !== (node.dataset.node !== 'placeholder')) {
        // no match
        parent.replaceChild(down ? create(TOP_RIGHT) : placeholder(TOP_RIGHT), node);
        this.recycle(node);
      } else if (down && inner.children[TOP_RIGHT].type === 'inner') {
        this.render(inner.children[TOP_RIGHT], node, rowFirst, rowLast, colFirst, colLast);
      }
    }
    {
      const node = children[BOTTOM_LEFT + 1];
      const down = showLeft && showBottom;
      if (down !== (node.dataset.node !== 'placeholder')) {
        // no matchmatch
        parent.replaceChild(down ? create(BOTTOM_LEFT) : placeholder(BOTTOM_LEFT), node);
        this.recycle(node);
      } else if (down && inner.children[BOTTOM_LEFT].type === 'inner') {
        this.render(inner.children[BOTTOM_LEFT], node, rowFirst, rowLast, colFirst, colLast);
      }
    }
    {
      const node = children[BOTTOM_RIGHT + 1];
      const down = showRight && showBottom;
      if (down !== (node.dataset.node !== 'placeholder')) {
        // no matchmatch
        parent.replaceChild(down ? create(BOTTOM_RIGHT) : placeholder(BOTTOM_RIGHT), node);
        this.recycle(node);
      } else if (down && inner.children[BOTTOM_RIGHT].type === 'inner') {
        this.render(inner.children[BOTTOM_RIGHT], node, rowFirst, rowLast, colFirst, colLast);
      }
    }

    return parent;
  }

  private recycle(node: HTMLElement) {
    if (node.dataset.node === 'leaf') {
      this.recycleLeaf(node);
      return;
    }
    //recycle all leaves
    const leaves = <HTMLElement[]>Array.from(node.querySelectorAll('[data-node=leaf]'));
    //recycle all inner nodes
    const inner = <HTMLElement[]>Array.from(node.querySelectorAll('[data-node=inner], [data-node=placeholder'));
    clear(node);
    leaves.forEach((node) => this.recycleLeaf(node));
    inner.forEach((node) => {
      clear(node);
      this.poolInner.push(ACellRenderer.cleanUp(node));
    });
    this.poolInner.push(ACellRenderer.cleanUp(node));
  }

  private static cleanUp(node: HTMLElement) {
    if (node.style.width) {
      node.style.width = null;
    }
    if (node.style.height) {
      node.style.height = null;
    }
    return node;
  }

  private recycleLeaf(node: HTMLElement) {
    this.poolLeaves.push(ACellRenderer.cleanUp(node));
  }


  protected clearPool() {
    // clear pool
    this.poolInner.splice(0, this.poolInner.length);
    this.poolLeaves.splice(0, this.poolLeaves.length);
  }
}

export default ACellRenderer;
