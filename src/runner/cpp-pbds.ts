// GCC 전용 정책 기반 자료구조(pb_ds)의 대체 헤더.
// libstdc++의 pb_ds는 libc++와 같이 쓸 수 없어서, 풀이에서 쓰는 범위만 직접 구현합니다.
// - tree<Key, Mapped, Cmp, rb_tree_tag, tree_order_statistics_node_update>
//   : insert/erase/find/lower_bound/upper_bound/find_by_order/order_of_key (모두 O(log n), 트립)
// - gp_hash_table / cc_hash_table: std::unordered_map / unordered_set
// pb_ds의 priority_queue, trie, rope는 지원하지 않습니다.

const ASSOC_CONTAINER = `#pragma once
#pragma GCC system_header
#include <cstddef>
#include <functional>
#include <iterator>
#include <memory>
#include <type_traits>
#include <unordered_map>
#include <unordered_set>
#include <utility>

namespace __gnu_pbds {
struct null_type {};
struct rb_tree_tag {};
struct splay_tree_tag {};
struct ov_tree_tag {};
template <class, class, class, class> struct null_node_update {};
template <class, class, class, class> struct tree_order_statistics_node_update {};

namespace __webcoder {
template <class Key, class Mapped> struct value_of {
    using type = std::pair<const Key, Mapped>;
    static const Key &key(const type &v) { return v.first; }
};
template <class Key> struct value_of<Key, null_type> {
    using type = Key;
    static const Key &key(const type &v) { return v; }
};
inline unsigned next_priority() {
    static unsigned s = 2463534242u;
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return s;
}
}

template <class Key, class Mapped, class Cmp = std::less<Key>, class Tag = rb_tree_tag,
          template <class, class, class, class> class Update = null_node_update,
          class Alloc = std::allocator<char>>
class tree {
    using VO = __webcoder::value_of<Key, Mapped>;

  public:
    using key_type = Key;
    using mapped_type = Mapped;
    using value_type = typename VO::type;
    using size_type = std::size_t;
    using difference_type = std::ptrdiff_t;
    using key_compare = Cmp;

  private:
    struct Node {
        value_type v;
        Node *l = nullptr, *r = nullptr, *p = nullptr;
        size_type n = 1;
        unsigned pri;
        template <class... A> explicit Node(A &&...a) : v(std::forward<A>(a)...), pri(__webcoder::next_priority()) {}
    };
    Node *root = nullptr;
    Cmp cmp;

    static size_type sz(const Node *x) { return x ? x->n : 0; }
    static void pull(Node *x) { x->n = 1 + sz(x->l) + sz(x->r); }
    static Node *leftmost(Node *x) {
        while (x && x->l) x = x->l;
        return x;
    }
    static Node *rightmost(Node *x) {
        while (x && x->r) x = x->r;
        return x;
    }
    static Node *succ(Node *x) {
        if (x->r) return leftmost(x->r);
        Node *p = x->p;
        while (p && p->r == x) {
            x = p;
            p = p->p;
        }
        return p;
    }
    static Node *pred(Node *x) {
        if (x->l) return rightmost(x->l);
        Node *p = x->p;
        while (p && p->l == x) {
            x = p;
            p = p->p;
        }
        return p;
    }
    /** x를 부모 위로 올립니다. */
    void rotate(Node *x) {
        Node *p = x->p, *g = p->p;
        if (p->l == x) {
            p->l = x->r;
            if (x->r) x->r->p = p;
            x->r = p;
        } else {
            p->r = x->l;
            if (x->l) x->l->p = p;
            x->l = p;
        }
        p->p = x;
        x->p = g;
        if (g) {
            if (g->l == p) g->l = x;
            else g->r = x;
        } else {
            root = x;
        }
        pull(p);
        pull(x);
    }
    static void destroy(Node *x) {
        while (x) {
            destroy(x->l);
            Node *r = x->r;
            delete x;
            x = r;
        }
    }
    static Node *clone(const Node *x, Node *parent) {
        if (!x) return nullptr;
        Node *c = new Node(x->v);
        c->pri = x->pri;
        c->n = x->n;
        c->p = parent;
        c->l = clone(x->l, c);
        c->r = clone(x->r, c);
        return c;
    }
    Node *find_node(const key_type &k) const {
        Node *c = root;
        while (c) {
            if (cmp(k, VO::key(c->v))) c = c->l;
            else if (cmp(VO::key(c->v), k)) c = c->r;
            else return c;
        }
        return nullptr;
    }
    Node *lower_node(const key_type &k) const {
        Node *c = root, *res = nullptr;
        while (c) {
            if (!cmp(VO::key(c->v), k)) {
                res = c;
                c = c->l;
            } else {
                c = c->r;
            }
        }
        return res;
    }
    Node *upper_node(const key_type &k) const {
        Node *c = root, *res = nullptr;
        while (c) {
            if (cmp(k, VO::key(c->v))) {
                res = c;
                c = c->l;
            } else {
                c = c->r;
            }
        }
        return res;
    }
    void erase_node(Node *x) {
        while (x->l || x->r) {
            Node *c = !x->l ? x->r : !x->r ? x->l : (x->l->pri > x->r->pri ? x->l : x->r);
            rotate(c);
        }
        Node *p = x->p;
        if (p) {
            if (p->l == x) p->l = nullptr;
            else p->r = nullptr;
            for (Node *a = p; a; a = a->p) a->n--;
        } else {
            root = nullptr;
        }
        delete x;
    }

    template <bool Const> class iter_t {
      public:
        const tree *_M_tree = nullptr;
        Node *_M_node = nullptr;
        using iterator_category = std::bidirectional_iterator_tag;
        using value_type = typename tree::value_type;
        using difference_type = std::ptrdiff_t;
        using reference = typename std::conditional<Const || std::is_same<Mapped, null_type>::value,
                                                    const value_type &, value_type &>::type;
        using pointer = typename std::remove_reference<reference>::type *;
        iter_t() = default;
        iter_t(const tree *t, Node *x) : _M_tree(t), _M_node(x) {}
        template <bool D, class = typename std::enable_if<Const && !D>::type>
        iter_t(const iter_t<D> &o) : _M_tree(o._M_tree), _M_node(o._M_node) {}
        reference operator*() const { return _M_node->v; }
        pointer operator->() const { return &_M_node->v; }
        iter_t &operator++() {
            _M_node = succ(_M_node);
            return *this;
        }
        iter_t operator++(int) {
            iter_t c = *this;
            ++*this;
            return c;
        }
        iter_t &operator--() {
            _M_node = _M_node ? pred(_M_node) : rightmost(_M_tree->root);
            return *this;
        }
        iter_t operator--(int) {
            iter_t c = *this;
            --*this;
            return c;
        }
        template <bool D> bool operator==(const iter_t<D> &o) const { return _M_node == o._M_node; }
        template <bool D> bool operator!=(const iter_t<D> &o) const { return _M_node != o._M_node; }
    };

  public:
    using iterator = iter_t<false>;
    using const_iterator = iter_t<true>;
    using point_iterator = iterator;
    using const_point_iterator = const_iterator;
    using reverse_iterator = std::reverse_iterator<iterator>;
    using const_reverse_iterator = std::reverse_iterator<const_iterator>;

    tree() = default;
    explicit tree(const Cmp &c) : cmp(c) {}
    template <class It> tree(It first, It last) {
        for (; first != last; ++first) insert(*first);
    }
    tree(const tree &o) : root(clone(o.root, nullptr)), cmp(o.cmp) {}
    tree(tree &&o) noexcept : root(o.root), cmp(std::move(o.cmp)) { o.root = nullptr; }
    tree &operator=(tree o) {
        swap(o);
        return *this;
    }
    ~tree() { destroy(root); }

    void swap(tree &o) {
        std::swap(root, o.root);
        std::swap(cmp, o.cmp);
    }
    size_type size() const { return sz(root); }
    bool empty() const { return !root; }
    void clear() {
        destroy(root);
        root = nullptr;
    }

    iterator begin() { return iterator(this, leftmost(root)); }
    iterator end() { return iterator(this, nullptr); }
    const_iterator begin() const { return const_iterator(this, leftmost(root)); }
    const_iterator end() const { return const_iterator(this, nullptr); }
    reverse_iterator rbegin() { return reverse_iterator(end()); }
    reverse_iterator rend() { return reverse_iterator(begin()); }
    const_reverse_iterator rbegin() const { return const_reverse_iterator(end()); }
    const_reverse_iterator rend() const { return const_reverse_iterator(begin()); }

    std::pair<iterator, bool> insert(const value_type &v) {
        const key_type &k = VO::key(v);
        Node *p = nullptr, *c = root;
        bool left = false;
        while (c) {
            p = c;
            if (cmp(k, VO::key(c->v))) {
                c = c->l;
                left = true;
            } else if (cmp(VO::key(c->v), k)) {
                c = c->r;
                left = false;
            } else {
                return {iterator(this, c), false};
            }
        }
        Node *x = new Node(v);
        x->p = p;
        if (!p) root = x;
        else if (left) p->l = x;
        else p->r = x;
        for (Node *a = p; a; a = a->p) a->n++;
        while (x->p && x->p->pri < x->pri) rotate(x);
        return {iterator(this, x), true};
    }
    bool erase(const key_type &k) {
        Node *x = find_node(k);
        if (!x) return false;
        erase_node(x);
        return true;
    }
    iterator erase(iterator it) {
        Node *next = succ(it._M_node);
        erase_node(it._M_node);
        return iterator(this, next);
    }
    template <class Pred> size_type erase_if(Pred pred) {
        size_type removed = 0;
        for (iterator it = begin(); it != end();) {
            if (pred(*it)) {
                it = erase(it);
                removed++;
            } else {
                ++it;
            }
        }
        return removed;
    }

    iterator find(const key_type &k) { return iterator(this, find_node(k)); }
    const_iterator find(const key_type &k) const { return const_iterator(this, find_node(k)); }
    iterator lower_bound(const key_type &k) { return iterator(this, lower_node(k)); }
    const_iterator lower_bound(const key_type &k) const { return const_iterator(this, lower_node(k)); }
    iterator upper_bound(const key_type &k) { return iterator(this, upper_node(k)); }
    const_iterator upper_bound(const key_type &k) const { return const_iterator(this, upper_node(k)); }

    template <class M = Mapped, class = typename std::enable_if<!std::is_same<M, null_type>::value>::type>
    M &operator[](const key_type &k) {
        Node *x = find_node(k);
        if (!x) x = insert(value_type(k, M())).first._M_node;
        return x->v.second;
    }

    /** 0부터 세어 order번째 원소. 범위를 벗어나면 end() */
    iterator find_by_order(size_type order) {
        Node *c = root;
        while (c) {
            size_type left = sz(c->l);
            if (order < left) {
                c = c->l;
            } else if (order == left) {
                break;
            } else {
                order -= left + 1;
                c = c->r;
            }
        }
        return iterator(this, c);
    }
    const_iterator find_by_order(size_type order) const {
        return const_iterator(this, const_cast<tree *>(this)->find_by_order(order)._M_node);
    }
    /** k보다 앞에 오는 원소의 수 */
    size_type order_of_key(const key_type &k) const {
        size_type count = 0;
        const Node *c = root;
        // libstdc++와 같은 순서로 비교합니다. (less_equal로 중복을 허용하는 풀이에서 결과가 같아야 함)
        while (c) {
            if (cmp(k, VO::key(c->v))) {
                c = c->l;
            } else if (cmp(VO::key(c->v), k)) {
                count += sz(c->l) + 1;
                c = c->r;
            } else {
                count += sz(c->l);
                break;
            }
        }
        return count;
    }

    /** other의 원소를 모두 옮겨 옵니다. */
    void join(tree &other) {
        for (const value_type &v : other) insert(v);
        other.clear();
    }
    /** k보다 큰 원소를 other로 옮깁니다. */
    void split(const key_type &k, tree &other) {
        other.clear();
        for (iterator it = upper_bound(k); it != end();) {
            other.insert(*it);
            it = erase(it);
        }
    }
};

template <class Key, class Mapped, class Hash = std::hash<Key>, class Eq = std::equal_to<Key>, class... Rest>
struct gp_hash_table : std::unordered_map<Key, Mapped, Hash, Eq> {
    using std::unordered_map<Key, Mapped, Hash, Eq>::unordered_map;
};
template <class Key, class Hash, class Eq, class... Rest>
struct gp_hash_table<Key, null_type, Hash, Eq, Rest...> : std::unordered_set<Key, Hash, Eq> {
    using std::unordered_set<Key, Hash, Eq>::unordered_set;
};
template <class Key, class Mapped, class Hash = std::hash<Key>, class Eq = std::equal_to<Key>, class... Rest>
struct cc_hash_table : std::unordered_map<Key, Mapped, Hash, Eq> {
    using std::unordered_map<Key, Mapped, Hash, Eq>::unordered_map;
};
template <class Key, class Hash, class Eq, class... Rest>
struct cc_hash_table<Key, null_type, Hash, Eq, Rest...> : std::unordered_set<Key, Hash, Eq> {
    using std::unordered_set<Key, Hash, Eq>::unordered_set;
};
}
`;

const FORWARD = '#pragma once\n#include <ext/pb_ds/assoc_container.hpp>\n';

/** 컴파일 파일 트리에 넣을 ext/ 폴더 */
export const PBDS_TREE = {
    pb_ds: {
        'assoc_container.hpp': ASSOC_CONTAINER,
        'tree_policy.hpp': FORWARD,
        'hash_policy.hpp': FORWARD,
        'tag_and_trait.hpp': FORWARD,
        detail: { 'standard_policies.hpp': FORWARD },
    },
};

/** GCC의 <bits/extc++.h> */
export const BITS_EXTCXX =
    '#pragma once\n#include <bits/stdc++.h>\n#include <ext/pb_ds/assoc_container.hpp>\n';
