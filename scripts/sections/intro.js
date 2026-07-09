// Category English mapping
const CATEGORY_NAMES = {
  'Action': 'Action',
  'Animation': 'Animation',
  'Horror': 'Horror',
  'Comedy': 'Comedy',
  'Sci-Fi': 'Sci-Fi',
  'Romance': 'Romance',
  'Mystery': 'Mystery',
  'Biography': 'Biography'
};

function getCategoryName(category) {
  return CATEGORY_NAMES[category] || category;
}

// ---- HSL 色彩空间工具 ----
function rgbToHsl(r, g, b) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h * 360, s * 100, l * 100];
}

function hslToRgb(h, s, l) {
  const hn = h / 360, sn = s / 100, ln = l / 100;
  if (sn === 0) {
    const v = Math.round(ln * 255);
    return [v, v, v];
  }
  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  const hueToRgb = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [
    Math.round(hueToRgb(hn + 1 / 3) * 255),
    Math.round(hueToRgb(hn) * 255),
    Math.round(hueToRgb(hn - 1 / 3) * 255)
  ];
}

// 在 HSL 空间做感知平均：色相用圆周均值，饱和度和亮度用算术均值
function perceptualAverage(colors) {
  if (colors.length === 0) return [128, 128, 128];
  let sumSin = 0, sumCos = 0, sumS = 0, sumL = 0;
  colors.forEach(([r, g, b]) => {
    const [h, s, l] = rgbToHsl(r, g, b);
    const rad = h * Math.PI / 180;
    sumSin += Math.sin(rad);
    sumCos += Math.cos(rad);
    sumS += s;
    sumL += l;
  });
  const n = colors.length;
  const avgH = (Math.atan2(sumSin / n, sumCos / n) * 180 / Math.PI + 360) % 360;
  return hslToRgb(avgH, sumS / n, sumL / n);
}

// 健壮的 CSV 行解析器：正确处理引号内的逗号
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// 从 CSV 读取电影列表
async function fetchCSVMovies() {
  const response = await fetch('assets/master_tiered_movies_view.csv');
  const csvText = await response.text();
  const lines = csvText.split('\n').slice(1);
  return lines.filter(l => l.trim()).map(line => {
    const cols = parseCSVLine(line);
    return {
      id: cols[0],
      title: cols[1],
      year: cols[2],
      category: cols[25] ? cols[25] : 'Other',
      poster: `assets/posters/${cols[0]}.jpg`
    };
  });
}

// 加载单部电影的条形码图片，采样为 N 个 RGB 色块
function loadBarcodeSamples(movieId, sampleCount = 100) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = sampleCount;
      canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, sampleCount, 1);
      const pixels = ctx.getImageData(0, 0, sampleCount, 1).data;
      const colors = [];
      for (let i = 0; i < pixels.length; i += 4) {
        colors.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
      }
      resolve(colors);
    };
    img.onerror = () => resolve([]);
    img.src = `assets/barcodes/${movieId}.png`;
  });
}

export async function initIntroSection() {
  const movies = await fetchCSVMovies();
  const introBarcode = document.getElementById('introBarcode');
  const avgColorContainer = document.getElementById('avgColorContainer');

  if (introBarcode) {
    await initIntroBarcode(introBarcode, movies);
  }
  if (avgColorContainer) {
    await initAvgColorDisplay(avgColorContainer, movies);
  }
}

async function initIntroBarcode(container, movies) {
  if (!container || movies.length === 0) return;

  const classicMovie = movies[0];
  const barcodeColors = await loadBarcodeSamples(classicMovie.id, 200);
  if (barcodeColors.length === 0) return;

  const barcodeElement = document.createElement('div');
  barcodeElement.className = 'intro-barcode';
  barcodeColors.forEach((color) => {
    const block = document.createElement('div');
    block.className = 'intro-barcode-block';
    block.style.backgroundColor = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
    block.style.width = '0.5%';
    block.style.height = '100%';
    block.style.display = 'inline-block';
    barcodeElement.appendChild(block);
  });
  container.appendChild(barcodeElement);

  const movieInfo = document.createElement('div');
  movieInfo.className = 'intro-movie-info';
  movieInfo.innerHTML = `
    <div class="intro-movie-poster">
      <img src="${classicMovie.poster}" alt="${classicMovie.title}" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjE1MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjE1MCIgZmlsbD0iI2UwZTBlMCIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LXNpemU9IjEwcHgiIGZpbGw9IiM5OTkiPjx0c3BhbiB4PSI1MCIgeT0iNTAiIGZvbnQtc2l6ZT0iMTAiIGZpbGw9IiM5OTkiPjwvdHNwYW4+PC90ZXh0Pjwvc3ZnPg=='">
    </div>
    <div class="intro-movie-details">
      <h4 class="intro-movie-title">${classicMovie.title}</h4>
      <p class="intro-movie-year">${classicMovie.year}</p>
      <p class="intro-movie-category">${classicMovie.category}</p>
    </div>
  `;
  container.appendChild(movieInfo);
}

async function initAvgColorDisplay(container, movies) {
  if (!container) return;

  // 第1级：为每部电影加载条形码，在 HSL 空间求感知平均色
  const movieAvgs = [];
  const samples = await Promise.all(
    movies.map(async (movie) => {
      const colors = await loadBarcodeSamples(movie.id, 100);
      return { movie, colors };
    })
  );
  samples.forEach(({ movie, colors }) => {
    if (colors.length > 0) {
      movieAvgs.push({ movie, avgRgb: perceptualAverage(colors) });
    }
  });

  // 第2级：按类别聚合每部电影的平均色，在 HSL 空间求类别级感知平均
  const categoryHslData = {};
  movieAvgs.forEach(({ movie, avgRgb }) => {
    if (!categoryHslData[movie.category]) {
      categoryHslData[movie.category] = { sumSin: 0, sumCos: 0, sumS: 0, sumL: 0, count: 0 };
    }
    const [h, s, l] = rgbToHsl(avgRgb[0], avgRgb[1], avgRgb[2]);
    const rad = h * Math.PI / 180;
    categoryHslData[movie.category].sumSin += Math.sin(rad);
    categoryHslData[movie.category].sumCos += Math.cos(rad);
    categoryHslData[movie.category].sumS += s;
    categoryHslData[movie.category].sumL += l;
    categoryHslData[movie.category].count++;
  });

  const categoryAvgColors = {};
  for (const [cat, d] of Object.entries(categoryHslData)) {
    const avgH = (Math.atan2(d.sumSin / d.count, d.sumCos / d.count) * 180 / Math.PI + 360) % 360;
    categoryAvgColors[cat] = hslToRgb(avgH, d.sumS / d.count, d.sumL / d.count);
  }

  const gridContainer = document.createElement('div');
  gridContainer.className = 'avg-color-grid';

  const sortedCategories = Object.keys(categoryAvgColors).sort();

  sortedCategories.forEach((cat) => {
    const avgColor = categoryAvgColors[cat];
    const catMovies = movies.filter(m => m.category === cat);
    const catName = getCategoryName(cat);

    const card = document.createElement('div');
    card.className = 'avg-color-card';
    card.dataset.category = cat;

    const colorDisplay = document.createElement('div');
    colorDisplay.className = 'avg-color-display';
    colorDisplay.style.backgroundColor = `rgb(${avgColor[0]}, ${avgColor[1]}, ${avgColor[2]})`;

    const infoSection = document.createElement('div');
    infoSection.className = 'avg-color-info';
    infoSection.innerHTML = `
      <h4 class="avg-color-category">${catName} (${cat})</h4>
      <p class="avg-color-count">${catMovies.length} movies</p>
    `;

    const posterGrid = document.createElement('div');
    posterGrid.className = 'avg-color-posters';
    catMovies.slice(0, 6).forEach((movie) => {
      const img = document.createElement('img');
      img.className = 'avg-color-poster';
      img.src = movie.poster;
      img.alt = movie.title;
      img.title = `${movie.title} (${movie.year})`;
      img.onerror = function () {
        this.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjE1MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjE1MCIgZmlsbD0iI2UwZTBlMCIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LXNpemU9IjEwcHgiIGZpbGw9IiM5OTkiPjx0c3BhbiB4PSI1MCIgeT0iNTAiIGZvbnQtc2l6ZT0iMTAiIGZpbGw9IiM5OTkiPjwvdHNwYW4+PC90ZXh0Pjwvc3ZnPg==';
      };
      posterGrid.appendChild(img);
    });

    card.appendChild(colorDisplay);
    card.appendChild(infoSection);
    card.appendChild(posterGrid);
    card.addEventListener('click', () => { showCategoryMovies(cat, catMovies); });
    gridContainer.appendChild(card);
  });

  container.appendChild(gridContainer);
}

function showCategoryMovies(category, movies) {
  let modal = document.getElementById('categoryMoviesModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'categoryMoviesModal';
    modal.className = 'category-movies-modal';
    document.body.appendChild(modal);
  }

  const catName = getCategoryName(category);
  modal.innerHTML = `
    <div class="modal-overlay" onclick="closeCategoryModal()"></div>
    <div class="modal-content">
      <div class="modal-header">
        <h3>${catName} (${category}) - ${movies.length} Movies</h3>
        <button class="modal-close" onclick="closeCategoryModal()">×</button>
      </div>
      <div class="modal-body">
        <div class="movies-grid">
          ${movies.map(m => `
            <div class="movie-card">
              <div class="movie-poster">
                <img src="${m.poster}" alt="${m.title}" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjE1MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjE1MCIgZmlsbD0iI2UwZTBlMCIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LXNpemU9IjEwcHgiIGZpbGw9IiM5OTkiPjx0c3BhbiB4PSI1MCIgeT0iNTAiIGZvbnQtc2l6ZT0iMTAiIGZpbGw9IiM5OTkiPjwvdHNwYW4+PC90ZXh0Pjwvc3ZnPg=='">
              </div>
              <div class="movie-info">
                <h4 class="movie-title">${m.title}</h4>
                <p class="movie-year">${m.year}</p>
                <p class="movie-category">${m.category}</p>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  modal.style.display = 'flex';
}

window.closeCategoryModal = function () {
  const modal = document.getElementById('categoryMoviesModal');
  if (modal) modal.style.display = 'none';
};
