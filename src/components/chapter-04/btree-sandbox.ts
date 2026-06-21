// §4 — The B-tree. Self-contained Python: a small-order B+-tree mapping
// id -> (page_no, slot), wired to an in-memory heap so lookup(id) does a
// search-then-fetch and counts pages touched (single digits vs a full scan's
// hundreds). Runs clean under python3 / Pyodide.
//
// Exported as a string so the MDX integrator can seed it into <PythonSandbox>.

export const BTREE_SANDBOX = `# A B+-tree index over a heap file.
# Internal nodes route; leaves hold key -> (page_no, slot) entries.

ORDER = 4  # max keys per node; the (ORDER+1)th forces a split

class Node:
    def __init__(self, leaf):
        self.leaf = leaf
        self.keys = []          # separator keys (internal) or data keys (leaf)
        self.children = []      # child Nodes (internal) or row-ids (leaf)

class BTree:
    def __init__(self, order=ORDER):
        self.order = order
        self.root = Node(leaf=True)

    def _child_index(self, node, key):
        i = 0
        while i < len(node.keys) and key >= node.keys[i]:
            i += 1
        return i

    def search(self, key):
        node, hops = self.root, 1
        while not node.leaf:
            node = node.children[self._child_index(node, key)]
            hops += 1
        for k, payload in zip(node.keys, node.children):
            if k == key:
                return payload, hops   # payload is (page_no, slot)
        return None, hops

    def insert(self, key, row_id):
        split = self._insert(self.root, key, row_id)
        if split:
            sep, right = split
            new_root = Node(leaf=False)
            new_root.keys = [sep]
            new_root.children = [self.root, right]
            self.root = new_root

    def _insert(self, node, key, row_id):
        if node.leaf:
            i = 0
            while i < len(node.keys) and node.keys[i] < key:
                i += 1
            node.keys.insert(i, key)
            node.children.insert(i, row_id)
            if len(node.keys) <= self.order:
                return None
            mid = (len(node.keys) + 1) // 2          # leaf split
            right = Node(leaf=True)
            right.keys = node.keys[mid:]
            right.children = node.children[mid:]
            node.keys = node.keys[:mid]
            node.children = node.children[:mid]
            return (right.keys[0], right)             # copy first key up
        i = self._child_index(node, key)
        split = self._insert(node.children[i], key, row_id)
        if not split:
            return None
        sep, right = split
        node.keys.insert(i, sep)
        node.children.insert(i + 1, right)
        if len(node.keys) <= self.order:
            return None
        mid = len(node.keys) // 2                     # internal split
        up = node.keys[mid]
        rnode = Node(leaf=False)
        rnode.keys = node.keys[mid + 1:]
        rnode.children = node.children[mid + 1:]
        node.keys = node.keys[:mid]
        node.children = node.children[:mid + 1]
        return (up, rnode)                            # push median up

    def height(self):
        h, node = 1, self.root
        while not node.leaf:
            node, h = node.children[0], h + 1
        return h

    def show(self):
        level = [self.root]
        while level:
            print("  ".join("[" + " ".join(map(str, n.keys)) + "]" for n in level))
            nxt = []
            for n in level:
                if not n.leaf:
                    nxt.extend(n.children)
            level = nxt

# A tiny page-based heap: rows packed PER_PAGE to a page, addressed by (page_no, slot).
PER_PAGE = 4
class Heap:
    def __init__(self):
        self.pages = []
    def insert(self, row):
        if not self.pages or len(self.pages[-1]) == PER_PAGE:
            self.pages.append([])
        page_no = len(self.pages) - 1
        self.pages[page_no].append(row)
        return (page_no, len(self.pages[page_no]) - 1)
    def fetch(self, addr):
        page_no, slot = addr
        return self.pages[page_no][slot]   # reading the row costs one page touch

import random
heap = Heap()
index = BTree(order=4)

# Load 200 accounts in random id order. Each row lands in the heap; the index
# records its (page_no, slot) address.
random.seed(42)
ids = random.sample(range(1, 100000), 200)
for n, acct in enumerate(ids):
    addr = heap.insert({"id": acct, "balance": 100 + n})  # row goes to the heap
    index.insert(acct, addr)                              # index records where

print("rows:", len(ids), " heap pages:", len(heap.pages), " index height:", index.height())
print("index shape (top 2 levels):")
top = [index.root]
for _ in range(2):
    print("  ".join("[" + " ".join(map(str, n.keys)) + "]" for n in top))
    nxt = []
    for n in top:
        if not n.leaf:
            nxt.extend(n.children)
    top = nxt

def scan(acct_id):
    # The heap's only option without an index: read every page, every row.
    pages = 0
    for page in heap.pages:
        pages += 1
        for row in page:
            if row["id"] == acct_id:
                return row, pages
    return None, pages

def lookup(acct_id):
    addr, hops = index.search(acct_id)      # walk the index: 'hops' nodes touched
    if addr is None:
        print(f"id {acct_id}: not found ({hops} index nodes read)")
        return None
    row = heap.fetch(addr)                  # one more page: the heap fetch
    return row, hops + 1

target = ids[123]
row, idx_pages = lookup(target)
_, scan_pages = scan(target)
print()
print(f"lookup id {target}: balance {row['balance']}")
print(f"  index seek : {idx_pages} pages touched")
print(f"  full scan  : {scan_pages} pages touched   <- the heap's only alternative")
_, miss_pages = index.search(424242)
print(f"miss id 424242: {miss_pages} index nodes read (a miss is just as cheap)")
`;
