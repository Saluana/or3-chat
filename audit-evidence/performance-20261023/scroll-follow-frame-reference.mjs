import { Fragment, computed, createCommentVNode, createElementBlock, createElementVNode, defineComponent, nextTick, normalizeStyle, onMounted, onUnmounted, openBlock, ref, renderList, renderSlot, shallowRef, useSlots, watch } from "vue";
// node_modules/or3-scroll/dist/or3-scroll.js
var re = class e {
	tree;
	capacity;
	constructor(t) {
		e.assertCapacity(t), this.capacity = t, this.tree = new Float64Array(t + 1);
	}
	static assertCapacity(e) {
		if (!Number.isSafeInteger(e) || e < 0) throw RangeError("FenwickTree capacity must be a non-negative safe integer.");
	}
	assertIndex(e) {
		if (!Number.isSafeInteger(e) || e < 0 || e >= this.capacity) throw RangeError(`FenwickTree index must be an integer between 0 and ${Math.max(0, this.capacity - 1)}.`);
	}
	resize(t, n) {
		e.assertCapacity(t), (t !== this.capacity || n) && (this.capacity = t, this.tree = new Float64Array(t + 1), n && this.build(n));
	}
	grow(t) {
		if (e.assertCapacity(t), t <= this.capacity) return;
		let n = this.capacity, r = new Float64Array(t);
		for (let e = 0; e < n; e++) r[e] = this.query(e) - (e > 0 ? this.query(e - 1) : 0);
		this.capacity = t, this.tree = new Float64Array(t + 1), this.build(r);
	}
	build(e) {
		this.tree.fill(0);
		let t = Math.min(this.capacity, e.length);
		for (let n = 0; n < t; n++) {
			if (!Number.isFinite(e[n])) throw RangeError("FenwickTree values must be finite.");
			this.tree[n + 1] = e[n];
		}
		for (let e = 1; e <= this.capacity; e++) {
			let t = e + (e & -e);
			t <= this.capacity && (this.tree[t] += this.tree[e]);
		}
	}
	update(e, t) {
		if (this.assertIndex(e), !Number.isFinite(t)) throw RangeError("FenwickTree update delta must be finite.");
		let n = e + 1;
		for (; n <= this.capacity;) this.tree[n] += t, n += n & -n;
	}
	query(e) {
		this.assertIndex(e);
		let t = 0, n = e + 1;
		for (; n > 0;) t += this.tree[n], n -= n & -n;
		return t;
	}
	lowerBound(e) {
		let t = 0, n = 1;
		for (; n <= this.capacity;) n <<= 1;
		for (n >>= 1; n > 0;) {
			let r = t + n;
			r <= this.capacity && e > this.tree[r] && (t = r, e -= this.tree[t]), n >>= 1;
		}
		return t;
	}
	upperBound(e) {
		let t = 0, n = 1;
		for (; n <= this.capacity;) n <<= 1;
		for (n >>= 1; n > 0;) {
			let r = t + n;
			r <= this.capacity && e >= this.tree[r] && (t = r, e -= this.tree[t]), n >>= 1;
		}
		return t;
	}
	total() {
		return this.capacity === 0 ? 0 : this.query(this.capacity - 1);
	}
	getCapacity() {
		return this.capacity;
	}
};
var ie = class {
	heights;
	flags;
	count = 0;
	capacity = 0;
	prefixSums;
	config;
	constructor(e) {
		if (!Number.isFinite(e.estimateHeight) || e.estimateHeight < 0) throw RangeError("estimateHeight must be a non-negative finite number.");
		this.config = {
			estimateHeight: e.estimateHeight,
			overscanTop: this.normalizeDistance(e.overscanTop),
			overscanBottom: this.normalizeDistance(e.overscanBottom),
			tailCount: this.normalizeCount(e.tailCount, "tailCount"),
			maxWindow: this.normalizeOptionalWindow(e.maxWindow)
		}, this.heights = /* @__PURE__ */ new Float64Array(), this.flags = /* @__PURE__ */ new Uint8Array(), this.prefixSums = new re(0);
	}
	setCount(e) {
		if (e = this.normalizeCount(e, "count"), e === this.count) return;
		let t = this.count;
		if (e < t) {
			for (let n = e; n < t; n++) this.prefixSums.update(n, -this.getEffectiveHeight(n)), this.heights[n] = NaN, this.flags[n] = 0;
			this.count = e;
			return;
		}
		this.ensureCapacity(e);
		for (let n = t; n < e; n++) this.heights[n] = NaN, this.flags[n] = 0, this.prefixSums.update(n, this.config.estimateHeight);
		this.count = e;
	}
	setHeight(e, t) {
		if (!Number.isSafeInteger(e)) throw RangeError("Height index must be a safe integer.");
		if (e < 0 || e >= this.count) return;
		if (Number.isNaN(t)) {
			if ((this.flags[e] & 1) != 1) return;
			let t = this.heights[e];
			this.heights[e] = NaN, this.flags[e] = 0, this.prefixSums.update(e, this.config.estimateHeight - t);
			return;
		}
		this.assertHeight(t);
		let n = this.heights[e], r = (this.flags[e] & 1) == 1;
		if (r && n === t) return;
		this.heights[e] = t, this.flags[e] |= 1;
		let i = r ? n : this.config.estimateHeight, a = t;
		this.prefixSums.update(e, a - i);
	}
	bulkInsert(e, t) {
		if (!Number.isSafeInteger(e)) throw RangeError("Insertion index must be a safe integer.");
		if (e < 0 || e > this.count) return;
		let n = t.length;
		if (n === 0) return;
		this.assertHeightList(t);
		let r = this.count, i = r + n;
		this.ensureCapacity(i), this.heights.copyWithin(e + n, e, r), this.flags.copyWithin(e + n, e, r);
		for (let r = 0; r < n; r++) {
			let n = t[r];
			this.heights[e + r] = n, this.flags[e + r] = 0, isNaN(n) || (this.flags[e + r] = 1);
		}
		this.count = i, this.rebuildPrefixSums();
	}
	replaceHeights(e) {
		this.assertHeightList(e);
		let t = e.length;
		this.shrinkCapacityForReplacement(t), this.ensureCapacity(t);
		for (let n = 0; n < t; n++) {
			let t = e[n];
			this.heights[n] = t, this.flags[n] = Number(!Number.isNaN(t));
		}
		for (let e = t; e < this.count; e++) this.heights[e] = NaN, this.flags[e] = 0;
		this.count = t, this.rebuildPrefixSums();
	}
	computeRange(e, t) {
		if (this.count === 0) return {
			startIndex: 0,
			endIndex: -1,
			offsetY: 0,
			totalHeight: 0
		};
		let n = this.getTotalHeight(), r = Number.isFinite(e) ? Math.max(0, e) : 0, i = Number.isFinite(t) ? Math.max(0, t) : 0, a = Math.max(0, r - this.config.overscanTop), o = Math.min(n, r + i + this.config.overscanBottom), s = this.findIndexForOffset(a), c = this.findIndexForOffset(o), l = this.findIndexForOffset(r);
		if (this.config.tailCount > 0 && this.count > 0) {
			let e = Math.max(0, this.count - this.config.tailCount);
			if (o >= this.getOffsetForIndex(e)) {
				let t = this.count - 1, n = Math.min(s, e), r = this.config.maxWindow ?? Infinity;
				if (t - n + 1 > r) {
					let e = Math.max(0, t - r + 1);
					n = Math.min(l, e);
				}
				s = n, c = t;
			}
		}
		s = Math.max(0, Math.min(s, this.count - 1)), c = Math.max(s, Math.min(c, this.count - 1));
		let u = this.getOffsetForIndex(s);
		return {
			startIndex: s,
			endIndex: c,
			offsetY: u,
			totalHeight: n
		};
	}
	findIndexForOffset(e) {
		return Number.isNaN(e) || e <= 0 ? 0 : e >= this.getTotalHeight() ? Math.max(0, this.count - 1) : Math.min(this.count - 1, this.prefixSums.upperBound(e));
	}
	getOffsetForIndex(e) {
		if (!Number.isSafeInteger(e) || e < 0 || e > this.count) throw RangeError(`Offset index must be an integer between 0 and ${this.count}.`);
		return e <= 0 ? 0 : this.prefixSums.query(e - 1);
	}
	getTotalHeight() {
		return this.count === 0 ? 0 : this.prefixSums.query(this.count - 1);
	}
	getCount() {
		return this.count;
	}
	getCapacity() {
		return this.capacity;
	}
	getMeasuredHeight(e) {
		if (!(!Number.isSafeInteger(e) || e < 0 || e >= this.count || (this.flags[e] & 1) != 1)) return this.heights[e];
	}
	updateOverscan(e, t) {
		this.config.overscanTop = this.normalizeDistance(e), this.config.overscanBottom = this.normalizeDistance(t);
	}
	updateMaxWindow(e) {
		this.config.maxWindow = this.normalizeOptionalWindow(e);
	}
	updateTailCount(e) {
		this.config.tailCount = this.normalizeCount(e, "tailCount");
	}
	resetHeights() {
		this.heights.fill(NaN, 0, this.count), this.flags.fill(0, 0, this.count), this.rebuildPrefixSums();
	}
	getEffectiveHeight(e) {
		return (this.flags[e] & 1) == 1 ? this.heights[e] : this.config.estimateHeight;
	}
	normalizeCount(e, t) {
		if (!Number.isFinite(e) || e < 0) throw RangeError(`${t} must be a non-negative finite number.`);
		let n = Math.floor(e);
		if (!Number.isSafeInteger(n)) throw RangeError(`${t} must fit in a safe integer.`);
		return n;
	}
	normalizeDistance(e) {
		return Number.isFinite(e) ? Math.max(0, e) : 0;
	}
	normalizeOptionalWindow(e) {
		return e === void 0 || e === Infinity ? e : this.normalizeCount(e, "maxWindow");
	}
	assertHeight(e) {
		if (!Number.isFinite(e) || e < 0) throw RangeError("Item heights must be non-negative finite numbers or NaN.");
	}
	assertHeightList(e) {
		for (let t of e) Number.isNaN(t) || this.assertHeight(t);
	}
	shrinkCapacityForReplacement(e) {
		if (this.capacity < 256) return;
		let t = e === 0 ? 0 : 16;
		for (; t < e;) t *= 2;
		t > this.capacity / 4 || (this.capacity = t, this.heights = new Float64Array(t), this.heights.fill(NaN), this.flags = new Uint8Array(t), this.prefixSums = new re(t));
	}
	ensureCapacity(e) {
		if (e <= this.capacity) return;
		let t = Math.max(16, this.capacity || 0);
		for (; t < e;) t *= 2;
		let n = new Float64Array(t);
		n.fill(NaN), n.set(this.heights.subarray(0, this.count));
		let r = new Uint8Array(t);
		r.set(this.flags.subarray(0, this.count)), this.heights = n, this.flags = r, this.capacity = t;
		let i = new Float64Array(t);
		for (let e = 0; e < this.count; e++) i[e] = this.getEffectiveHeight(e);
		this.prefixSums = new re(t), this.prefixSums.build(i);
	}
	rebuildPrefixSums() {
		let e = new Float64Array(this.capacity);
		for (let t = 0; t < this.count; t++) e[t] = this.getEffectiveHeight(t);
		this.prefixSums.build(e);
	}
};
var m = new class {
	ro = null;
	callbacks;
	constructor() {
		this.callbacks = /* @__PURE__ */ new Map();
	}
	getObserver() {
		return this.ro ? this.ro : typeof ResizeObserver > "u" ? null : (this.ro = new ResizeObserver((e) => {
			for (let t of e) {
				let e = this.callbacks.get(t.target);
				e && e(t);
			}
		}), this.ro);
	}
	observe(e, t) {
		let n = this.callbacks.has(e);
		this.callbacks.set(e, t), n || this.getObserver()?.observe(e);
	}
	unobserve(e) {
		this.callbacks.delete(e), this.ro?.unobserve(e);
	}
	disconnect() {
		this.ro?.disconnect(), this.ro = null, this.callbacks.clear();
	}
}();
var ae = {
	key: 0,
	class: "or3-scroll-prepend-loading"
};
var oe = ["data-index"];
var se = {
	key: 1,
	class: "or3-scroll-hidden-pool",
	"aria-hidden": "true"
};
var ce = 140;
var h$1 = .5;
var le = /*#__PURE__*/ ((e, t) => {
	let n = e.__vccOpts || e;
	for (let [e, r] of t) n[e] = r;
	return n;
})(/* @__PURE__ */ defineComponent({
	__name: "Or3Scroll",
	props: {
		items: {},
		estimateHeight: { default: 50 },
		overscan: { default: 200 },
		prefetchOverscan: { default: 0 },
		itemKey: {},
		maintainBottom: {
			type: Boolean,
			default: !0
		},
		loadingHistory: {
			type: Boolean,
			default: !1
		},
		tailCount: { default: 0 },
		paddingBottom: { default: 0 },
		paddingTop: { default: 0 },
		bottomThreshold: { default: 3 },
		autoscrollThreshold: { default: 10 },
		mutationMode: { default: "append-prepend" },
		contentKey: { default: void 0 },
		rowContentRevision: { default: 0 }
	},
	emits: [
		"scroll",
		"reachTop",
		"reachBottom",
		"prefetchRange"
	],
	setup(a, { expose: re, emit: le }) {
		let g = a, ue = le, de = useSlots(), fe = Number.isFinite(g.estimateHeight) && g.estimateHeight > 0 ? g.estimateHeight : 50, _ = ref(null), pe = ref(null), v = ref(0), y = ref(!0), b = ref(0), x = ref(-1), me = ref(0), he = ref(0), S = ref(0), ge = ref(0), C = 0, _e = 0, w = g.maintainBottom ? "followingBottom" : "userBrowsing", T = null, E = null, D = !1, O = !1, ve = 0, ye = !1, k = !1, A = 0, be = 0, xe = 0, Se = 0, j = null, M = 0, Ce = 0, we = 0, N = 0, Te = !1, Ee = !1, P = -1, De = -1, F = new ie({
			estimateHeight: fe,
			overscanTop: g.overscan,
			overscanBottom: g.overscan,
			tailCount: g.tailCount,
			maxWindow: void 0
		}), I = [], L = /* @__PURE__ */ new Map(), R = /* @__PURE__ */ new Map(), Oe = computed(() => {
			g.rowContentRevision;
			let e = x.value === -1 ? 0 : x.value + 1;
			return g.items.slice(b.value, e);
		}), z = (e) => typeof g.itemKey == "function" ? g.itemKey(e) : e[g.itemKey], ke = (e) => typeof requestAnimationFrame == "function" ? requestAnimationFrame(e) : (queueMicrotask(() => e(Date.now())), 0), B = (e) => {
			e && typeof cancelAnimationFrame == "function" && cancelAnimationFrame(e);
		}, Ae = (e) => {
			let t = typeof devicePixelRatio == "number" && devicePixelRatio > 0 ? devicePixelRatio : 1;
			return Math.round(e * t) / t;
		}, je = () => {
			L.clear(), I.forEach((e, t) => L.set(e, t));
		}, Me = () => {
			if (I.length === 0) return null;
			_.value && (C = _.value.scrollTop);
			let e = C - g.paddingTop, t = F.findIndexForOffset(Math.max(0, e)), n = I[t];
			return n === void 0 ? null : { candidates: [{
				key: n,
				withinItem: e - F.getOffsetForIndex(t),
				index: t
			}] };
		}, V = () => {
			if (I.length === 0) return null;
			if (_.value) {
				C = _.value.scrollTop;
				let e = _.value.getBoundingClientRect();
				if (e.height > 0 && Math.abs(e.height - _.value.clientHeight) < 2) {
					let t = [];
					for (let [n, r] of X) {
						let i = r.getBoundingClientRect();
						if (i.bottom <= e.top + h$1 || i.top >= e.bottom) continue;
						let a = L.get(n);
						a !== void 0 && t.push({
							key: n,
							top: i.top,
							withinItem: e.top - i.top,
							index: a
						});
					}
					if (t.length > 0) return t.sort((e, t) => e.top - t.top), { candidates: t.map((e) => ({
						key: e.key,
						withinItem: e.withinItem,
						index: e.index
					})) };
				}
			}
			return Me();
		}, H = (e) => {
			let t = Math.max(0, e);
			S.value = t, pe.value && (pe.value.style.height = `${t + g.paddingTop + g.paddingBottom}px`);
		}, smoothScroll = !1, programmaticScrollMatches = (top) => T !== null && (T === "jump" || smoothScroll || E !== null && Math.abs(top - E) < 1), U = (e, t, n = !1) => {
			let r = _.value;
			if (!r) return;
			let i = Math.max(0, S.value + g.paddingTop + g.paddingBottom - r.clientHeight), a = Math.max(0, Math.min(e, i));
			T = t, E = a, smoothScroll = n, n ? r.scrollTo({
				top: a,
				behavior: "smooth"
			}) : r.scrollTop = a, C = r.scrollTop;
		}, Ne = (e) => {
			if (!e || !_.value) return;
			let t;
			for (let n of e.candidates) {
				let e = L.get(n.key);
				if (e === void 0) continue;
				let r = Math.abs(e - n.index);
				(!t || r < t.displacement) && (t = {
					point: n,
					index: e,
					displacement: r
				});
			}
			if (!t) return;
			let n = g.paddingTop + F.getOffsetForIndex(t.index) + t.point.withinItem;
			if (Math.abs(n - _.value.scrollTop) < h$1) return;
			let r = w;
			w = "compensatingLayout", U(n, "compensation"), w = r;
		}, Pe = () => Math.max(0, C - Math.max(0, g.paddingTop)), W = () => {
			let { overscanTop: e, overscanBottom: t, maxWindow: n } = Fe();
			F.updateOverscan(e, t), F.updateMaxWindow(n);
			let r = F.computeRange(Pe(), v.value);
			b.value !== r.startIndex && (b.value = r.startIndex), x.value !== r.endIndex && (x.value = r.endIndex), me.value !== r.offsetY && (me.value = r.offsetY), he.value !== r.totalHeight && (he.value = r.totalHeight);
		}, Fe = () => {
			let e = Number.isFinite(g.overscan) ? Math.max(0, g.overscan) : 200, t = Number.isFinite(g.tailCount) ? Math.max(0, Math.floor(g.tailCount)) : 0, n = v.value / fe;
			return {
				overscanTop: e,
				overscanBottom: e,
				maxWindow: Math.max(t, Math.ceil(n * 2))
			};
		}, G = () => {
			if (g.prefetchOverscan <= 0 || I.length === 0) return;
			let e = Number.isFinite(g.prefetchOverscan) ? Math.max(0, g.prefetchOverscan) : 0, t = Pe(), n = F.findIndexForOffset(Math.max(0, t - e)), r = F.findIndexForOffset(Math.min(F.getTotalHeight(), t + v.value + e));
			n === P && r === De || (P = n, De = r, ue("prefetchRange", {
				startIndex: n,
				endIndex: r
			}));
		}, followFrame = 0, Ie = (e, t) => {
			H(F.getTotalHeight()), t && g.maintainBottom ? nextTick(() => {
				followFrame || (followFrame = ke(() => {
					followFrame = 0;
					!k && w === "followingBottom" && !D && lt();
				}));
			}) : Ne(e);
		}, K = (e, t) => {
			if (D) {
				Ne(e);
				return;
			}
			Ie(e, t);
		}, Le = () => S.value + g.paddingTop + g.paddingBottom, q = (e, t) => {
			let n = _.value;
			if (!n) return;
			let r = Le() - (n.scrollTop + n.clientHeight), i = r <= g.bottomThreshold;
			y.value = i, t || (e < -.5 && r > g.autoscrollThreshold ? w = "userBrowsing" : e > h$1 && i && g.maintainBottom && (w = "followingBottom"));
		}, Re = () => {
			let e = C <= h$1;
			e && !Te && ue("reachTop"), !e && C > 1.5 ? Te = !1 : e && (Te = !0), y.value && !Ee && ue("reachBottom");
			let t = _.value;
			t && (Le() - (t.scrollTop + t.clientHeight) > g.bottomThreshold + 1 ? Ee = !1 : y.value && (Ee = !0));
		}, J = () => {
			_.value && (C = _.value.scrollTop, q(0, !0), Re());
		}, ze = () => {
			A && (be++, B(A), A = 0, Ve()), j &&= (clearTimeout(j), null);
			let e = D;
			D = !1, ve = 0, _.value && (C = _.value.scrollTop, q(0, !0)), (w === "programmaticJump" || e) && (w = g.maintainBottom && y.value ? "followingBottom" : "userBrowsing"), T = null, E = null;
			let t = F.getTotalHeight();
			Math.abs(S.value - t) >= h$1 && Ie(V(), w === "followingBottom"), J();
		}, Be = () => {
			j && clearTimeout(j), j = setTimeout(() => {
				j = null, O || ze();
			}, ce);
		}, Ve = () => {
			A = 0;
			let e = _.value;
			if (!e || k) return;
			C = e.scrollTop;
			let t = C - _e, n = programmaticScrollMatches(C);
			n || (T = null, E = null);
			!n && Math.abs(t) > h$1 && (D = !0), E !== null && Math.abs(C - E) < 1 && T !== "jump" && (T = null, E = null), q(t, n), W(), G(), de.__debug && (ge.value = C), ue("scroll", {
				scrollTop: C,
				scrollHeight: e.scrollHeight,
				clientHeight: v.value,
				isAtBottom: y.value
			}), Re(), _e = C, (D || T === "jump") && Be();
		}, Y = () => {
			if (A || k) return;
			let e = ++be;
			A = ke(() => {
				e === be && Ve();
			});
		}, He = () => {
			if (!_.value) return;
			let top = _.value.scrollTop;
			if (!programmaticScrollMatches(top) && top < C - h$1) T = null, E = null, D = !0, q(top - C, !1);
			C = top, Y();
		}, Ue = () => {
			T === "jump" && (ve = Date.now() + ce), D = !0, T = null, E = null, N++, y.value || (w = "userBrowsing"), $(), Be();
		}, We = () => {
			O = !0, Ue();
		}, Ge = () => {
			O && (O = !1, (D || T === "jump") && Be());
		}, Ke = (e) => {
			[
				"ArrowUp",
				"ArrowDown",
				"PageUp",
				"PageDown",
				"Home",
				"End",
				" "
			].includes(e.key) && Ue();
		}, qe = () => {
			O || D && Date.now() < ve || !A && !D && T !== "jump" || ze();
		}, Je = shallowRef([]), Ye = /* @__PURE__ */ new Map(), Xe = (e, t) => {
			t ? Ye.set(e, t) : Ye.delete(e);
		}, X = /* @__PURE__ */ new Map(), Z = /* @__PURE__ */ new Map(), Ze = (e, t) => {
			let n = z(t), r = Z.get(n);
			if (r) return r;
			let i = (e) => {
				if (e) {
					let t = e instanceof Element ? e : e.$el, r = X.get(n);
					if (r === t) return;
					r && m.unobserve(r), X.set(n, t), m.observe(t, (e) => {
						let t = e.borderBoxSize?.[0]?.blockSize ?? e.contentRect.height;
						$e(n, t);
					});
				} else {
					let e = X.get(n);
					e && m.unobserve(e), X.delete(n), Z.delete(n);
				}
			};
			return Z.set(n, i), i;
		}, Q = /* @__PURE__ */ new Map(), Qe = !1, measurementFrame = 0, $e = (e, t) => {
			let n = Ae(t), r = R.get(e);
			r !== void 0 && Math.abs(r - n) < h$1 || (Q.set(e, n), Qe || (Qe = !0, measurementFrame = ke(et)));
		}, et = () => {
			B(measurementFrame), measurementFrame = 0;
			if (Qe = !1, Q.size === 0 || k) return;
			_.value && (C = _.value.scrollTop);
			let e = Me(), t = !1;
			for (let [e, n] of Q) {
				let r = L.get(e);
				if (r === void 0) continue;
				let i = R.get(e);
				i !== void 0 && Math.abs(i - n) < h$1 || (R.set(e, n), F.setHeight(r, n), t = !0);
			}
			if (Q.clear(), !t) return;
			W();
			let n = g.maintainBottom && w === "followingBottom" && !D;
			K(e, n), J();
		}, tt = (e) => {
			let t = new Set(e);
			for (let e of R.keys()) t.has(e) || R.delete(e);
			for (let e of Z.keys()) {
				if (t.has(e)) continue;
				let n = X.get(e);
				n && m.unobserve(n), X.delete(e), Z.delete(e);
			}
		}, nt = (e) => {
			I.splice(0, I.length, ...e), je();
		}, rt = (e, t = !1) => {
			let n = V(), r = e.map(z);
			if (t && R.clear(), tt(r), F.replaceHeights(r.map((e) => R.get(e) ?? NaN)), nt(r), W(), P = -1, G(), ye) {
				let e = g.maintainBottom && w === "followingBottom" && !D;
				K(n, e), J();
			}
		}, it = (e, t) => {
			let n = V();
			for (let n = t; n < e.length; n++) {
				let t = z(e[n]);
				I.push(t), L.set(t, n);
			}
			F.setCount(e.length), W(), P = -1, G(), ye && (K(n, g.maintainBottom && w === "followingBottom" && !D), J());
		}, at = async (e, t, n) => {
			let r = e.slice(0, t).map((e, t) => ({
				item: e,
				index: t,
				key: z(e)
			})), i = r.map((e) => R.get(e.key) ?? NaN);
			if (k || n !== M) return;
			let a = V();
			r.forEach((e, t) => {
				Number.isNaN(i[t]) || R.set(e.key, i[t]);
			}), F.bulkInsert(0, i), I.unshift(...r.map((e) => e.key)), F.getCount() < e.length && F.setCount(e.length);
			for (let t = I.length; t < e.length; t++) I.push(z(e[t]));
			je(), W(), P = -1, G(), K(a, !1), J();
		}, ot = async () => {
			let e = ++M, t = g.items, n = t.length, r = I.length;
			if (r === 0) {
				rt(t);
				return;
			}
			if (g.mutationMode === "arbitrary") {
				rt(t);
				return;
			}
			if (n === 0) {
				rt(t);
				return;
			}
			let i = I[0], a = I[r - 1], o = z(t[0]), s = z(t[n - 1]);
			if (n === r && o === i && s === a) return;
			if (n > r && o === i && z(t[r - 1]) === a) {
				it(t, r);
				return;
			}
			let c = n - r;
			if (c > 0 && z(t[c]) === i && z(t[c + r - 1]) === a) {
				await at(t, c, e);
				return;
			}
			if (n < r && o === i && s === I[n - 1]) {
				let e = V();
				I.splice(n), tt(I), je(), F.setCount(n), W(), P = -1, G(), ye && (K(e, !1), J());
				return;
			}
			rt(t);
		}, $ = () => {
			Ce++, B(xe), B(Se), B(followFrame), xe = 0, Se = 0, followFrame = 0;
		}, st = (e = !1) => {
			$();
			let t = Ce, n = M;
			xe = ke(() => {
				xe = 0, Se = ke(() => {
					Se = 0, t === Ce && (!e || n === M) && !k && g.maintainBottom && lt();
				});
			});
		}, ct = () => {
			M++, we++, N++, be++, B(A), A = 0, j &&= (clearTimeout(j), null), D = !1, O = !1, ve = 0, $(), Q.clear(), Je.value = [], Ye.clear(), X.forEach((e) => m.unobserve(e)), X.clear(), Z.clear(), R.clear(), w = g.maintainBottom ? "followingBottom" : "userBrowsing", T = null, E = null, C = 0, _e = 0, P = -1, De = -1, _.value && (_.value.scrollTop = 0), rt(g.items, !0), H(F.getTotalHeight()), J();
			let e = M;
			nextTick(() => {
				k || e !== M || ht();
			}), g.maintainBottom && st();
		}, lt = (e = {}) => {
			if (!_.value) return;
			w = "followingBottom", H(F.getTotalHeight());
			let t = Math.max(0, Le() - _.value.clientHeight);
			U(t, "bottom", e.smooth === !0), Y();
		}, ut = (e, t, n) => {
			let r = F.getOffsetForIndex(e) + g.paddingTop;
			return t === "center" ? r -= v.value / 2 - n / 2 : t === "end" && (r -= v.value - n), Math.max(0, r);
		}, dt = (e, t = {}) => {
			if (!_.value || !Number.isSafeInteger(e) || e < 0 || e >= g.items.length) return;
			$();
			let n = ++N, r = t.align ?? "start", i = I[e];
			w = "programmaticJump", H(F.getTotalHeight());
			let a = R.get(i) ?? F.getMeasuredHeight(e) ?? fe;
			U(ut(e, r, a), "jump", t.smooth === !0), Y(), nextTick(() => {
				ke(() => {
					if (n !== N || k) return;
					let e = L.get(i);
					if (e === void 0) return;
					let a = X.get(i)?.getBoundingClientRect().height;
					if (a && a > 0) {
						let t = Ae(a);
						R.set(i, t), F.setHeight(e, t), W(), H(F.getTotalHeight());
					}
					let o = R.get(i) ?? F.getMeasuredHeight(e) ?? fe;
					U(ut(e, r, o), "jump", t.smooth === !0), Y();
				});
			});
		}, ft = (e, t = {}) => {
			let n = L.get(e);
			n !== void 0 && dt(n, t);
		}, pt = () => (_.value && (C = _.value.scrollTop), {
			version: 1,
			contentKey: g.contentKey,
			mode: y.value ? "bottom" : "anchor",
			anchors: V()?.candidates.map((e) => ({
				key: e.key,
				withinItem: e.withinItem,
				index: e.index
			})),
			scrollTop: C
		}), mt = async (e) => {
			if (!e || e.version !== 1 || (await nextTick(), !_.value)) return;
			if (e.mode === "bottom") {
				lt();
				return;
			}
			$(), j &&= (clearTimeout(j), null), D = !1, w = "userBrowsing", T = null, E = null;
			let t = (e.anchors ?? []).filter((e) => (typeof e.key == "string" || typeof e.key == "number") && Number.isFinite(e.withinItem) && Number.isSafeInteger(e.index));
			t.length ? Ne({ candidates: t }) : U(e.scrollTop, "jump"), Y();
		}, ht = () => {
			for (let [e, t] of X) {
				let n = t.getBoundingClientRect().height;
				n > 0 && $e(e, n);
			}
			Qe ? et() : W();
		}, gt = () => ct(), _t = null, viewportResizeFrame = 0, pendingViewportHeight = 0, vt = (e) => {
			if (!_.value || e === v.value) return;
			let t = V();
			v.value = e, W(), Ie(t, g.maintainBottom && w === "followingBottom"), q(0, !0), G();
		};
		return onMounted(() => {
			ye = !0;
			let e = _.value;
			e && (C = e.scrollTop, _e = e.scrollTop, v.value = e.clientHeight, typeof ResizeObserver < "u" && (_t = new ResizeObserver((e) => {
				const entry = e[e.length - 1];
				if (!entry) return;
				pendingViewportHeight = entry.contentRect.height;
				if (viewportResizeFrame) return;
				viewportResizeFrame = ke(() => {
					viewportResizeFrame = 0;
					if (!k) vt(pendingViewportHeight);
				});
			}), _t.observe(e)), W(), H(F.getTotalHeight()), G(), g.maintainBottom && st(!0));
		}), onUnmounted(() => {
			k = !0, M++, we++, N++, be++, B(A), A = 0, $(), j && clearTimeout(j), _t?.disconnect(), B(viewportResizeFrame), viewportResizeFrame = 0, X.forEach((e) => m.unobserve(e)), X.clear(), Z.clear(), Q.clear(), B(measurementFrame), measurementFrame = 0;
		}), watch(() => {
			let e = g.items;
			return g.mutationMode === "arbitrary" ? e.map(z) : [e, e.length];
		}, () => void ot(), { immediate: !0 }), watch(() => g.contentKey, (e, t) => {
			e !== t && ct();
		}), watch(() => [g.paddingBottom, g.paddingTop], () => {
			let e = V();
			Ie(e, g.maintainBottom && w === "followingBottom");
		}), watch(() => [g.overscan, g.prefetchOverscan], () => {
			P = -1, De = -1, W(), G();
		}), watch(() => g.tailCount, (e) => {
			F.updateTailCount(e), W();
		}), watch(() => g.maintainBottom, (e) => {
			e && (q(0, !0), w = y.value ? "followingBottom" : "userBrowsing");
		}), watch(() => g.estimateHeight, (e, t) => {}), re({
			scrollToBottom: lt,
			scrollToIndex: dt,
			scrollToItemKey: ft,
			captureScrollState: pt,
			restoreScrollState: mt,
			refreshMeasurements: ht,
			reset: gt,
			isAtBottom: y
		}), (t, o) => (openBlock(), createElementBlock("div", {
			ref_key: "container",
			ref: _,
			class: "or3-scroll",
			onScrollPassive: He,
			onTouchstartPassive: We,
			onTouchendPassive: Ge,
			onTouchcancelPassive: Ge,
			onMousedownPassive: Ue,
			onWheelPassive: Ue,
			onKeydown: Ke,
			onScrollendPassive: qe
		}, [createElementVNode("div", {
			ref_key: "track",
			ref: pe,
			class: "or3-scroll-track",
			style: normalizeStyle({ height: S.value + a.paddingTop + a.paddingBottom + "px" })
		}, [
			a.loadingHistory ? (openBlock(), createElementBlock("div", ae, [renderSlot(t.$slots, "prepend-loading", {}, void 0, !0)])) : createCommentVNode("", !0),
			createElementVNode("div", {
				class: "or3-scroll-slice",
				style: normalizeStyle({ transform: `translateY(${me.value + a.paddingTop}px)` })
			}, [(openBlock(!0), createElementBlock(Fragment, null, renderList(Oe.value, (e, n) => (openBlock(), createElementBlock("div", {
				key: z(e),
				ref_for: !0,
				ref: Ze(b.value + n, e),
				class: "or3-scroll-item",
				"data-index": b.value + n
			}, [renderSlot(t.$slots, "default", {
				item: e,
				index: b.value + n
			}, void 0, !0)], 8, oe))), 128))], 4),
			Je.value.length ? (openBlock(), createElementBlock("div", se, [(openBlock(!0), createElementBlock(Fragment, null, renderList(Je.value, (e, n) => (openBlock(), createElementBlock("div", {
				key: e.key,
				ref_for: !0,
				ref: (e) => Xe(n, e),
				class: "or3-scroll-item"
			}, [renderSlot(t.$slots, "default", {
				item: e.item,
				index: e.index
			}, void 0, !0)], 512))), 128))])) : createCommentVNode("", !0),
			renderSlot(t.$slots, "__debug", {
				startIndex: b.value,
				endIndex: x.value,
				totalHeight: he.value,
				scrollTop: ge.value
			}, void 0, !0)
		], 4)], 544));
	}
}), [["__scopeId", "data-v-d4e02d1c"]]);
function g(e) {
	let { scrollerRef: t, items: n, getItemId: r, loadHistoryUntil: i } = e, a = ref({ state: "idle" }), s = 0, c, l = (e) => n.value.findIndex((t) => r(t) === e), u = async (e, n, r) => {
		if (r !== s || l(e) === -1 || (a.value = {
			state: "jumping",
			targetId: e,
			align: n
		}, await nextTick(), r !== s || l(e) === -1)) return !1;
		let i = t.value;
		return i ? (i.scrollToItemKey(e, { align: n }), r === s && (a.value = { state: "idle" }), !0) : !1;
	};
	return watch(() => {
		let e = a.value;
		return e.state === "waitingForHistory" ? l(e.targetId) : -1;
	}, (e) => {
		if (e === -1) return;
		let t = c;
		t?.generation === s && t.settle({ kind: "target" });
	}, { flush: "post" }), {
		jumpTo: async (e, t = {}) => {
			let n = t.align ?? "center", r = t.direction ?? "up";
			c?.settle({ kind: "superseded" });
			let d = ++s;
			if (l(e) !== -1) {
				await u(e, n, d) || d === s && (a.value = { state: "idle" });
				return;
			}
			a.value = {
				state: "waitingForHistory",
				targetId: e,
				direction: r,
				align: n
			};
			let ee, f = new Promise((e) => {
				ee = e;
			});
			c = {
				generation: d,
				settle: ee
			};
			let te = Promise.resolve().then(() => i(e, r)).then(() => ({ kind: "loaded" }), (e) => ({
				kind: "error",
				error: e
			})), ne = await Promise.race([te, f]);
			if (c?.generation === d && (c = void 0), !(d !== s || ne.kind === "superseded")) {
				if (ne.kind === "error") {
					console.error("[useScrollJump] Failed to load history:", ne.error), a.value = { state: "idle" };
					return;
				}
				await nextTick(), !await u(e, n, d) && d === s && (a.value = { state: "idle" });
			}
		},
		jumpState: a
	};
}
export { le as Or3Scroll, ie as VirtualizerEngine, g as useScrollJump };
