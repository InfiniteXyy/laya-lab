const products = [
  { id: 'headphones', name: 'Studio Headphones', price: 129, category: 'audio', symbol: '🎧' },
  { id: 'lamp', name: 'Arc Desk Lamp', price: 79, category: 'lighting', symbol: '☀' },
  { id: 'keyboard', name: 'Mechanical Keyboard', price: 99, category: 'desk', symbol: '⌨' },
];
const cart = new Set();
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function render() {
  const query = document.querySelector('#search').value.trim().toLowerCase();
  const category = document.querySelector('#category').value;
  const visible = products.filter(p => (category === 'all' || p.category === category) && p.name.toLowerCase().includes(query));
  document.querySelector('#catalog-state').textContent = `Showing ${visible.length} products · Category: ${category}${query ? ` · Search: ${query}` : ''}`;
  document.querySelector('#products').innerHTML = visible.map(p => `<article class="product"><div class="product-art" aria-hidden="true"><span class="product-number">0${products.indexOf(p) + 1} / ORBIT</span><span>${p.symbol}</span></div><div class="product-body"><span class="product-category">${p.category}</span><h2>${p.name}</h2><p class="product-price">$${p.price}</p><button data-add="${p.id}" aria-label="Add ${p.name} to cart" ${cart.has(p.id) ? 'disabled' : ''}>${cart.has(p.id) ? 'Added to cart ✓' : 'Add to cart +'}</button></div></article>`).join('') || '<p class="no-products">No products match your search.</p>';
  document.querySelector('#cart-count').textContent = String(cart.size);
  document.querySelector('#cart-items').innerHTML = cart.size ? products.filter(p => cart.has(p.id)).map(p => `<div class="cart-item"><strong>${p.name}</strong><div><span>Qty 1 · $${p.price}</span><button data-remove="${p.id}" aria-label="Remove ${p.name} from cart">Remove</button></div></div>`).join('') : '<p class="empty-cart">Your cart is empty.</p>';
  document.querySelector('#subtotal').textContent = `$${products.filter(p => cart.has(p.id)).reduce((n, p) => n + p.price, 0)}`;
  document.querySelector('#clear-cart').disabled = cart.size === 0;
}
document.addEventListener('click', event => {
  const add = event.target.closest('[data-add]'); const remove = event.target.closest('[data-remove]');
  if (add) { cart.add(add.dataset.add); document.querySelector('#shop-status').textContent = `${products.find(p => p.id === add.dataset.add).name} was added to your cart.`; render(); }
  if (remove) { cart.delete(remove.dataset.remove); document.querySelector('#shop-status').textContent = `${products.find(p => p.id === remove.dataset.remove).name} was removed from your cart.`; render(); }
});
document.querySelector('#clear-cart').onclick = () => { cart.clear(); document.querySelector('#shop-status').textContent = 'Cart cleared.'; render(); };
document.querySelector('#search').addEventListener('input', render);
document.querySelector('#category').addEventListener('change', render);
render();
